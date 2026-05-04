import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EmbeddingProvider, RerankProvider } from "@/modules/embedding";
import { ingestDocument } from "@/modules/ingestion";
import {
	applyReranking,
	deduplicateByBestSimilarity,
	formatSearchResult,
} from "@/modules/mcp/searchResults";
import type { DocumentRepository, SearchResult } from "@/modules/repository";
import type { StorageProvider } from "@/modules/storage";
import type { VisionProvider } from "@/modules/vision";

// ---------------------------------------------------------------------------
// Shared dependency shape
// ---------------------------------------------------------------------------

export interface SharedDeps {
	repo: DocumentRepository;
	embedder: EmbeddingProvider;
	vision: VisionProvider;
	reranker: RerankProvider | null;
	storage: StorageProvider | null;
}

// ---------------------------------------------------------------------------
// Artifact URL resolution
// ---------------------------------------------------------------------------

/** TTL for pre-signed artifact URLs, in seconds (default: 1 hour). */
const _rawTtl = Number(process.env.ARTIFACT_URL_TTL_SECONDS);
const ARTIFACT_URL_TTL_SECONDS =
	Number.isFinite(_rawTtl) && _rawTtl > 0 && _rawTtl <= 604800 ? _rawTtl : 3600;

/**
 * Resolve pre-signed URLs for a batch of search results.
 * Results without an artifactKey resolve to null.
 * When `userId` is provided, URLs are only generated for documents owned by
 * that user — other users' artifacts remain readable as content but their
 * original files are not exposed via pre-signed links.
 * Individual failures are caught and logged — a bad URL on one result
 * should never block the entire response.
 */
export async function resolveArtifactUrls(
	results: SearchResult[],
	storage: StorageProvider | null,
	userId?: string,
): Promise<(string | null)[]> {
	if (!storage) return results.map(() => null);

	return Promise.all(
		results.map(async (r) => {
			if (!r.artifactKey) return null;
			if (userId && r.userId && r.userId !== userId) return null;
			try {
				return await storage.getPresignedUrl(
					r.artifactKey,
					ARTIFACT_URL_TTL_SECONDS,
				);
			} catch (err) {
				console.error("[storage] failed to generate pre-signed URL", {
					artifactKey: r.artifactKey,
					error: err,
				});
				return null;
			}
		}),
	);
}

export interface ServerDeps extends SharedDeps {
	userId: string;
}

// ---------------------------------------------------------------------------
// MCP server factory — registers all tools onto a new McpServer instance
// ---------------------------------------------------------------------------

export function createServer({
	repo,
	embedder,
	vision,
	reranker,
	storage,
	userId,
}: ServerDeps): McpServer {
	const server = new McpServer({
		name: "bonfire",
		version: "0.1.0",
	});

	// -------------------------------------------------------------------------
	// Tool: add_document
	// -------------------------------------------------------------------------

	server.registerTool(
		"add_document",
		{
			title: "Add Document",
			description:
				"Add a new knowledge base document or update an existing one. " +
				"Accepts markdown content. Provide `id` to update an existing document.",
			inputSchema: {
				title: z.string().describe("Short, descriptive title for the document"),
				content: z
					.string()
					.describe("Full document content in markdown format"),
				tags: z
					.array(z.string())
					.optional()
					.describe(
						"Tags for categorisation and filtering (e.g. ['marketing', 'hubspot'])",
					),
				date: z.iso
					.datetime()
					.optional()
					.describe(
						"ISO 8601 date representing when the work occurred (e.g. PR merge date). " +
							"Used for temporal filtering — independent of when this document was ingested.",
					),
				id: z
					.string()
					.refine(
						(v) => !v.includes(":chunk:"),
						"id must not contain the reserved ':chunk:' namespace",
					)
					.optional()
					.describe("Document ID — omit to create a new document"),
			},
		},
		async ({ title, content, tags, date, id }) => {
			const doc = await ingestDocument(
				{ id, title, content, tags, date, userId },
				repo,
				embedder,
			);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								id: doc.id,
								title: doc.title,
								tags: doc.tags,
								date: doc.date,
								createdAt: doc.createdAt,
								updatedAt: doc.updatedAt,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	// -------------------------------------------------------------------------
	// Tool: search_documents
	// -------------------------------------------------------------------------

	server.registerTool(
		"search_documents",
		{
			title: "Search Documents",
			description:
				"Search the knowledge base using natural language. Returns the most " +
				"semantically relevant documents ranked by similarity score.",
			inputSchema: {
				query: z
					.string()
					.describe(
						"Natural language search query, e.g. 'How do I issue a refund for a gift card purchase?'",
					),
				limit: z
					.number()
					.int()
					.min(1)
					.max(20)
					.optional()
					.describe("Maximum number of results to return (default: 5)"),
				tag: z
					.string()
					.optional()
					.describe("Restrict results to documents with this tag"),
				since: z.iso
					.datetime()
					.optional()
					.describe(
						"ISO 8601 timestamp — only return documents whose date (or createdAt if date is unset) is at or after this time",
					),
				before: z.iso
					.datetime()
					.optional()
					.describe(
						"ISO 8601 timestamp — only return documents whose date (or createdAt if date is unset) is before this time",
					),
			},
		},
		async ({ query, limit, tag, since, before }) => {
			const finalLimit = limit ?? 5;
			const candidateLimit = reranker
				? Math.min(finalLimit * 4, 40)
				: finalLimit;

			const embedding = await embedder.embed(query);
			const candidates = await repo.search({
				embedding,
				limit: candidateLimit,
				tag,
				since,
				before,
			});

			const results =
				reranker && candidates.length > 0
					? await applyReranking(reranker, query, candidates, finalLimit)
					: candidates;

			if (results.length === 0) {
				return {
					content: [{ type: "text", text: "No matching documents found." }],
				};
			}

			// Pre-compute artifact URLs before formatting (formatSearchResult is sync).
			const artifactUrls = await resolveArtifactUrls(results, storage, userId);
			const formatted = results.map((r, i) =>
				formatSearchResult(r, artifactUrls[i]),
			);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(formatted, null, 2),
					},
				],
			};
		},
	);

	// -------------------------------------------------------------------------
	// Tool: get_document
	// -------------------------------------------------------------------------

	server.registerTool(
		"get_document",
		{
			title: "Get Document",
			description: "Retrieve the full content of a document by its ID.",
			inputSchema: {
				id: z.string().describe("Document ID"),
			},
		},
		async ({ id }) => {
			const doc = await repo.getById(id);

			if (!doc) {
				return {
					content: [{ type: "text", text: `Document not found: ${id}` }],
					isError: true,
				};
			}

			// Only generate a pre-signed URL if the caller owns the document.
			let artifactUrl: string | null = null;
			const callerOwnsDoc = !doc.userId || doc.userId === userId;
			if (doc.artifactKey && storage && callerOwnsDoc) {
				try {
					artifactUrl = await storage.getPresignedUrl(
						doc.artifactKey,
						ARTIFACT_URL_TTL_SECONDS,
					);
				} catch (err) {
					console.error("[storage] failed to generate pre-signed URL", {
						artifactKey: doc.artifactKey,
						error: err,
					});
				}
			}

			const { artifactKey: _key, ...docFields } = doc;
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ ...docFields, artifactUrl }, null, 2),
					},
				],
			};
		},
	);

	// -------------------------------------------------------------------------
	// Tool: list_documents
	// -------------------------------------------------------------------------

	server.registerTool(
		"list_documents",
		{
			title: "List Documents",
			description:
				"List all documents in the knowledge base. Optionally filter by tag.",
			inputSchema: {
				tag: z.string().optional().describe("Filter documents by this tag"),
			},
		},
		async ({ tag }) => {
			const docs = await repo.list({ tag });

			if (docs.length === 0) {
				const msg = tag
					? `No documents found with tag "${tag}".`
					: "The knowledge base is empty.";
				return { content: [{ type: "text", text: msg }] };
			}

			const summary = docs.map((d) => ({
				id: d.id,
				title: d.title,
				tags: d.tags,
				date: d.date,
				updatedAt: d.updatedAt,
			}));

			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	// -------------------------------------------------------------------------
	// Tool: query_knowledge_base
	// -------------------------------------------------------------------------

	server.registerTool(
		"query_knowledge_base",
		{
			title: "Query Knowledge Base",
			description:
				"Answer a question by retrieving and synthesizing the most relevant documents " +
				"from the knowledge base. Runs multiple semantic searches in parallel (using the " +
				"question plus any extra queries you provide), deduplicates results, and returns " +
				"the top documents ranked by relevance. Use this instead of search_documents when " +
				"you need a comprehensive answer that may span several documents.",
			inputSchema: {
				question: z
					.string()
					.describe("The question or topic to look up in the knowledge base"),
				extra_queries: z
					.array(z.string())
					.max(4)
					.optional()
					.describe(
						"Up to 4 additional search queries to broaden retrieval — useful when " +
							"the question may be answered by documents using different terminology",
					),
				limit: z
					.number()
					.int()
					.min(1)
					.max(20)
					.optional()
					.describe(
						"Maximum number of documents to return after merging (default: 8)",
					),
				tag: z
					.string()
					.optional()
					.describe("Restrict results to documents with this tag"),
				since: z.iso
					.datetime()
					.optional()
					.describe(
						"ISO 8601 timestamp — only return documents whose date (or createdAt if date is unset) is at or after this time",
					),
				before: z.iso
					.datetime()
					.optional()
					.describe(
						"ISO 8601 timestamp — only return documents whose date (or createdAt if date is unset) is before this time",
					),
			},
		},
		async ({ question, extra_queries, limit, tag, since, before }) => {
			const finalLimit = limit ?? 8;
			const perQueryLimit = reranker ? 20 : Math.min(20, finalLimit + 2);

			const queries = [question, ...(extra_queries ?? [])];
			const allResults = await Promise.all(
				queries.map(async (q) => {
					const embedding = await embedder.embed(q);
					return repo.search({
						embedding,
						limit: perQueryLimit,
						tag,
						since,
						before,
					});
				}),
			);

			const dedupLimit = reranker ? Math.min(finalLimit * 4, 40) : finalLimit;
			const merged = deduplicateByBestSimilarity(allResults, dedupLimit);

			const results =
				reranker && merged.length > 0
					? await applyReranking(reranker, question, merged, finalLimit)
					: merged.slice(0, finalLimit);

			if (results.length === 0) {
				return {
					content: [{ type: "text", text: "No relevant documents found." }],
				};
			}

			// Pre-compute artifact URLs before formatting (formatSearchResult is sync).
			const artifactUrls = await resolveArtifactUrls(results, storage, userId);
			const formatted = results.map((r, i) =>
				formatSearchResult(r, artifactUrls[i]),
			);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(formatted, null, 2),
					},
				],
			};
		},
	);

	// -------------------------------------------------------------------------
	// Tool: add_image
	// -------------------------------------------------------------------------

	server.registerTool(
		"add_image",
		{
			title: "Add Image",
			description:
				"Analyze an image (photo of handwritten notes, whiteboard, diagram, etc.) " +
				"and store the extracted content as a knowledge base document. " +
				"The image is transcribed and described by an AI vision model before storage.",
			inputSchema: {
				image_data: z
					.string()
					.describe("Base64-encoded image data (without the data URI prefix)"),
				media_type: z
					.enum(["image/jpeg", "image/png", "image/gif", "image/webp"])
					.describe("MIME type of the image"),
				title: z
					.string()
					.optional()
					.describe(
						"Title for the document — if omitted, one is generated from the image content",
					),
				tags: z
					.array(z.string())
					.optional()
					.describe(
						"Tags for categorisation — if omitted, tags are generated automatically " +
							"from the image content and title (e.g. ['meeting-notes', 'q2-planning'])",
					),
				id: z
					.string()
					.refine(
						(v) => !v.includes(":chunk:"),
						"id must not contain the reserved ':chunk:' namespace",
					)
					.optional()
					.describe("Document ID — omit to create a new document"),
				context: z
					.string()
					.optional()
					.describe(
						"Optional hint about the image content to guide analysis " +
							"(e.g. 'whiteboard from sprint planning meeting on 2026-04-17')",
					),
				date: z.iso
					.datetime()
					.optional()
					.describe(
						"ISO 8601 date representing when the work occurred. " +
							"Used for temporal filtering — independent of when this document was ingested.",
					),
			},
		},
		async ({ image_data, media_type, title, tags, id, context, date }) => {
			const result = await vision.analyzeImage(
				{ data: image_data, mediaType: media_type },
				{ title, context },
			);

			const resolvedTitle = title ?? result.title;
			const resolvedTags = tags ?? result.tags;
			const doc = await ingestDocument(
				{
					id,
					title: resolvedTitle,
					content: result.content,
					tags: resolvedTags,
					date,
					userId,
				},
				repo,
				embedder,
			);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								id: doc.id,
								title: doc.title,
								tags: doc.tags,
								date: doc.date,
								createdAt: doc.createdAt,
								updatedAt: doc.updatedAt,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	// -------------------------------------------------------------------------

	// -------------------------------------------------------------------------

	server.registerTool(
		"delete_document",
		{
			title: "Delete Document",
			description: "Permanently delete a document from the knowledge base.",
			inputSchema: {
				id: z.string().describe("Document ID to delete"),
			},
		},
		async ({ id }) => {
			const deleted = await repo.delete(id);

			if (!deleted) {
				return {
					content: [{ type: "text", text: `Document not found: ${id}` }],
					isError: true,
				};
			}

			return {
				content: [{ type: "text", text: `Document ${id} deleted.` }],
			};
		},
	);

	return server;
}
