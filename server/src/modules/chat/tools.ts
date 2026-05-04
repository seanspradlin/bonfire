import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import type { EmbeddingProvider, RerankProvider } from "@/modules/embedding";
import {
	applyReranking,
	deduplicateByBestSimilarity,
	type FormattedSearchResult,
	formatSearchResult,
} from "@/modules/mcp/searchResults";
import { resolveArtifactUrls } from "@/modules/mcp/tools";
import type { DocumentRepository } from "@/modules/repository";
import type { StorageProvider } from "@/modules/storage";

// ---------------------------------------------------------------------------
// Tool definitions exposed to Claude
// ---------------------------------------------------------------------------

export const CHAT_TOOLS: Tool[] = [
	{
		name: "query_knowledge_base",
		description:
			"Answer a question by retrieving and synthesizing the most relevant documents " +
			"from the knowledge base. Runs multiple semantic searches in parallel (using the " +
			"question plus any extra queries you provide), deduplicates results, and returns " +
			"the top documents ranked by relevance. Prefer this over search_documents for any " +
			"substantive factual question.",
		input_schema: {
			type: "object",
			properties: {
				question: {
					type: "string",
					description: "The question or topic to look up in the knowledge base",
				},
				extra_queries: {
					type: "array",
					items: { type: "string" },
					maxItems: 4,
					description:
						"Up to 4 additional search queries to broaden retrieval — useful when " +
						"the question may be answered by documents using different terminology",
				},
				limit: {
					type: "number",
					minimum: 1,
					maximum: 20,
					description: "Maximum number of documents to return (default: 6)",
				},
				tag: {
					type: "string",
					description: "Restrict results to documents with this tag",
				},
			},
			required: ["question"],
		},
	},
	{
		name: "search_documents",
		description:
			"Run a single semantic search against the knowledge base. Use this when you " +
			"need to check whether a specific document or term exists. For open-ended " +
			"questions, prefer query_knowledge_base.",
		input_schema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Natural language search query" },
				limit: {
					type: "number",
					minimum: 1,
					maximum: 20,
					description: "Maximum number of results (default: 5)",
				},
				tag: {
					type: "string",
					description: "Restrict results to documents with this tag",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "get_document",
		description:
			"Retrieve the full content of a document by its ID. Useful after a search " +
			"when a result's excerpt doesn't contain the full answer.",
		input_schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Document ID" },
			},
			required: ["id"],
		},
	},
	{
		name: "list_documents",
		description:
			"List top-level documents in the knowledge base, optionally filtered by tag. " +
			"Useful when the user asks what is in the knowledge base.",
		input_schema: {
			type: "object",
			properties: {
				tag: {
					type: "string",
					description: "Filter documents by this tag",
				},
			},
		},
	},
];

// ---------------------------------------------------------------------------
// Prompt-injection mitigation helpers
// ---------------------------------------------------------------------------

/**
 * Escape closing tags that would break the XML-like document wrapper, and
 * escape double-quotes in values used inside XML attributes.
 *
 * Without this, a document whose body contains literal `</document>` (or
 * `</body>` / `</title>`) would close the wrapper early, undermining the
 * untrusted-data boundary enforced by the system prompt.
 */
function escapeDocumentTags(s: string): string {
	// Replace </document>, </body>, </title> (case-insensitive) with an
	// escaped form that won't be parsed as a real closing tag by the model.
	return s.replace(/<\/(document|body|title)>/gi, "<\\/$1>");
}

function escapeAttr(s: string): string {
	return s.replace(/"/g, "&quot;");
}

/**
 * Wrap a single document's body in structured XML-like tags so the model
 * can clearly distinguish knowledge-base content from its own instructions.
 * The routes.ts system prompt instructs the model to treat this content as
 * untrusted data only.
 */
function wrapSingleDocument(doc: {
	id: string;
	title: string;
	content: string;
}): string {
	const safeId = escapeAttr(doc.id);
	const safeTitle = escapeDocumentTags(doc.title);
	const safeContent = escapeDocumentTags(doc.content);
	return `<document id="${safeId}">\n<title>${safeTitle}</title>\n<body>\n${safeContent}\n</body>\n</document>`;
}

/**
 * Convert an array of formatted search results into wrapped document strings.
 * Returns plain objects so callers can JSON.stringify the full result payload.
 */
function wrapDocumentsInTags(
	results: FormattedSearchResult[],
): Array<Omit<FormattedSearchResult, "content"> & { document: string }> {
	return results.map(({ content, ...rest }) => ({
		...rest,
		document: wrapSingleDocument({ id: rest.id, title: rest.title, content }),
	}));
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export interface ChatToolSource {
	id: string;
	title: string;
}

export interface ChatToolResult {
	/** JSON-serialised payload sent back to Claude as tool_result content. */
	text: string;
	/** Documents referenced by this call, used to build the final citation list. */
	sources: ChatToolSource[];
}

export interface ChatToolContext {
	repo: DocumentRepository;
	embedder: EmbeddingProvider;
	reranker: RerankProvider | null;
	storage: StorageProvider | null;
	userId: string;
	/** Abort signal from the combined client-disconnect + idle-timeout controller. */
	signal?: AbortSignal;
}

export async function runChatTool(
	name: string,
	input: unknown,
	ctx: ChatToolContext,
): Promise<ChatToolResult> {
	const args = (input ?? {}) as Record<string, unknown>;

	switch (name) {
		case "query_knowledge_base":
			return runQueryKnowledgeBase(args, ctx);
		case "search_documents":
			return runSearchDocuments(args, ctx);
		case "get_document":
			return runGetDocument(args, ctx);
		case "list_documents":
			return runListDocuments(args, ctx);
		default:
			return {
				text: JSON.stringify({ error: `Unknown tool: ${name}` }),
				sources: [],
			};
	}
}

async function runQueryKnowledgeBase(
	args: Record<string, unknown>,
	{ repo, embedder, reranker, storage, userId, signal }: ChatToolContext,
): Promise<ChatToolResult> {
	const question = String(args.question ?? "");
	const extra = Array.isArray(args.extra_queries)
		? args.extra_queries.filter((q): q is string => typeof q === "string")
		: [];
	const limit = typeof args.limit === "number" ? args.limit : 6;
	const tag = typeof args.tag === "string" ? args.tag : undefined;

	const queries = [question, ...extra].filter((q) => q.length > 0);
	if (queries.length === 0) {
		return {
			text: JSON.stringify({ error: "question is required" }),
			sources: [],
		};
	}

	// Bail out early if the client has already disconnected.
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

	const perQueryLimit = reranker ? 20 : Math.min(20, limit + 2);
	const allResults = await Promise.all(
		queries.map(async (q) => {
			// Re-check before each embedding call; each is a network round-trip.
			if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
			const embedding = await embedder.embed(q);
			if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
			return repo.search({ embedding, limit: perQueryLimit, tag });
		}),
	);

	const dedupLimit = reranker ? Math.min(limit * 4, 40) : limit;
	const merged = deduplicateByBestSimilarity(allResults, dedupLimit);

	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
	const results =
		reranker && merged.length > 0
			? await applyReranking(reranker, question, merged, limit)
			: merged.slice(0, limit);

	if (results.length === 0) {
		return {
			text: JSON.stringify({
				results: [],
				note: "No relevant documents found.",
			}),
			sources: [],
		};
	}

	const artifactUrls = await resolveArtifactUrls(results, storage, userId);
	const formatted = results.map((r, i) =>
		formatSearchResult(r, artifactUrls[i]),
	);
	return {
		text: JSON.stringify({ results: wrapDocumentsInTags(formatted) }),
		sources: formatted.map((r) => ({
			id: r.parentId ?? r.id,
			title: r.title,
		})),
	};
}

async function runSearchDocuments(
	args: Record<string, unknown>,
	{ repo, embedder, reranker, storage, userId, signal }: ChatToolContext,
): Promise<ChatToolResult> {
	const query = String(args.query ?? "");
	const finalLimit = typeof args.limit === "number" ? args.limit : 5;
	const tag = typeof args.tag === "string" ? args.tag : undefined;

	if (!query) {
		return {
			text: JSON.stringify({ error: "query is required" }),
			sources: [],
		};
	}

	const candidateLimit = reranker ? Math.min(finalLimit * 4, 40) : finalLimit;

	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
	const embedding = await embedder.embed(query);
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
	const candidates = await repo.search({
		embedding,
		limit: candidateLimit,
		tag,
	});

	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
	const results =
		reranker && candidates.length > 0
			? await applyReranking(reranker, query, candidates, finalLimit)
			: candidates;

	if (results.length === 0) {
		return {
			text: JSON.stringify({
				results: [],
				note: "No matching documents found.",
			}),
			sources: [],
		};
	}

	const artifactUrls = await resolveArtifactUrls(results, storage, userId);
	const formatted = results.map((r, i) =>
		formatSearchResult(r, artifactUrls[i]),
	);
	return {
		text: JSON.stringify({ results: wrapDocumentsInTags(formatted) }),
		sources: formatted.map((r) => ({
			id: r.parentId ?? r.id,
			title: r.title,
		})),
	};
}

async function runGetDocument(
	args: Record<string, unknown>,
	{ repo, signal }: ChatToolContext,
): Promise<ChatToolResult> {
	const id = String(args.id ?? "");
	if (!id) {
		return { text: JSON.stringify({ error: "id is required" }), sources: [] };
	}

	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
	const doc = await repo.getById(id);
	if (!doc) {
		return {
			text: JSON.stringify({ error: `Document not found: ${id}` }),
			sources: [],
		};
	}

	// Wrap the body in structured tags so the model treats it as untrusted data.
	const wrapped = wrapSingleDocument({
		id: doc.id,
		title: doc.title,
		content: doc.content,
	});

	return {
		text: JSON.stringify({
			id: doc.id,
			title: doc.title,
			tags: doc.tags,
			date: doc.date,
			document: wrapped,
		}),
		sources: [{ id: doc.parentId ?? doc.id, title: doc.title }],
	};
}

async function runListDocuments(
	args: Record<string, unknown>,
	{ repo, signal }: ChatToolContext,
): Promise<ChatToolResult> {
	const tag = typeof args.tag === "string" ? args.tag : undefined;
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
	const docs = await repo.list({ tag });

	if (docs.length === 0) {
		const msg = tag
			? `No documents found with tag "${tag}".`
			: "The knowledge base is empty.";
		return { text: JSON.stringify({ results: [], note: msg }), sources: [] };
	}

	const summary = docs.map((d) => ({
		id: d.id,
		title: d.title,
		tags: d.tags,
		date: d.date,
	}));
	return { text: JSON.stringify({ results: summary }), sources: [] };
}
