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
import type { WikiPageRepository } from "@/modules/wiki";

// ---------------------------------------------------------------------------
// Shared dependency shape
// ---------------------------------------------------------------------------

export interface SharedDeps {
	repo: DocumentRepository;
	embedder: EmbeddingProvider;
	vision: VisionProvider;
	reranker: RerankProvider | null;
	storage: StorageProvider | null;
	wikiRepo: WikiPageRepository;
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
	wikiRepo,
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

	// -------------------------------------------------------------------------
	// Tool: create_wiki_page
	// -------------------------------------------------------------------------

	server.registerTool(
		"create_wiki_page",
		{
			title: "Create Wiki Page",
			description:
				"Create a new wiki page synthesized from source documents. " +
				"Use this when no wiki page exists for the concept. " +
				"Check with get_wiki_page first to confirm the slug is available.",
			inputSchema: {
				slug: z
					.string()
					.regex(
						/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
						"Slug must be lowercase alphanumeric words separated by hyphens (e.g. 'team-onboarding')",
					)
					.describe(
						"URL-safe identifier for the page (e.g. 'team-onboarding', 'api-rate-limits')",
					),
				title: z.string().describe("Human-readable title for the wiki page"),
				content: z
					.string()
					.describe("Full wiki page content in markdown format"),
				tags: z
					.array(z.string())
					.optional()
					.describe("Tags for categorisation and filtering"),
				source_document_ids: z
					.array(z.string())
					.optional()
					.describe(
						"IDs of the source documents this wiki page was synthesized from",
					),
			},
		},
		async ({ slug, title, content, tags, source_document_ids }) => {
			// Guard against overwriting an existing page — the LLM should use
			// update_wiki_page for that to avoid accidental data loss.
			const existing = await wikiRepo.getBySlug(slug);
			if (existing) {
				return {
					content: [
						{
							type: "text",
							text: `A wiki page already exists for slug "${slug}". Use update_wiki_page to modify it instead.`,
						},
					],
					isError: true,
				};
			}

			const embedding = await embedder.embed(content);
			const page = await wikiRepo.upsertBySlug({
				slug,
				title,
				content,
				tags,
				sourceDocumentIds: source_document_ids,
				embedding,
				userId,
			});

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								slug: page.slug,
								title: page.title,
								tags: page.tags,
								createdAt: page.createdAt,
								updatedAt: page.updatedAt,
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
	// Tool: update_wiki_page
	// -------------------------------------------------------------------------

	server.registerTool(
		"update_wiki_page",
		{
			title: "Update Wiki Page",
			description:
				"Update an existing wiki page. Use get_wiki_page first to read the current " +
				"content before overwriting. Fails if the page does not exist — use " +
				"create_wiki_page for new pages.",
			inputSchema: {
				slug: z.string().describe("Slug of the wiki page to update"),
				title: z
					.string()
					.optional()
					.describe("New title — if omitted, the existing title is preserved"),
				content: z
					.string()
					.describe("New full wiki page content in markdown format"),
				tags: z
					.array(z.string())
					.optional()
					.describe("Updated tags — if omitted, existing tags are preserved"),
				source_document_ids: z
					.array(z.string())
					.optional()
					.describe("Updated source document IDs"),
			},
		},
		async ({ slug, title, content, tags, source_document_ids }) => {
			const existing = await wikiRepo.getBySlug(slug);
			if (!existing) {
				return {
					content: [
						{
							type: "text",
							text: `No wiki page found for slug "${slug}". Use create_wiki_page to create a new page instead.`,
						},
					],
					isError: true,
				};
			}

			const embedding = await embedder.embed(content);
			const page = await wikiRepo.upsertBySlug({
				slug,
				// Fall back to the existing title if not provided
				title: title ?? existing.title,
				content,
				tags: tags ?? existing.tags,
				sourceDocumentIds: source_document_ids ?? existing.sourceDocumentIds,
				embedding,
				userId,
			});

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								slug: page.slug,
								title: page.title,
								tags: page.tags,
								updatedAt: page.updatedAt,
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
	// Tool: delete_wiki_page
	// -------------------------------------------------------------------------

	server.registerTool(
		"delete_wiki_page",
		{
			title: "Delete Wiki Page",
			description:
				"Permanently delete a wiki page by slug. Use during lint when a page is confirmed " +
				"orphaned, superseded, or a duplicate. This cannot be undone.",
			inputSchema: {
				slug: z.string().describe("Slug of the wiki page to delete"),
			},
		},
		async ({ slug }) => {
			const deleted = await wikiRepo.delete(slug);

			if (!deleted) {
				return {
					content: [
						{
							type: "text",
							text: `No wiki page found for slug "${slug}".`,
						},
					],
					isError: true,
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Wiki page "${slug}" has been permanently deleted.`,
					},
				],
			};
		},
	);

	// -------------------------------------------------------------------------
	// Tool: get_wiki_page
	// -------------------------------------------------------------------------

	server.registerTool(
		"get_wiki_page",
		{
			title: "Get Wiki Page",
			description:
				"Retrieve a wiki page by its slug. Returns null-like result when no page " +
				"exists — use this to detect gaps before creating new pages or to read " +
				"current content before updating.",
			inputSchema: {
				slug: z.string().describe("Slug of the wiki page to retrieve"),
			},
		},
		async ({ slug }) => {
			const page = await wikiRepo.getBySlug(slug);

			if (!page) {
				// Not isError — a missing page is expected during gap detection
				return {
					content: [
						{
							type: "text",
							text: `No wiki page found for slug "${slug}". Use create_wiki_page to synthesize one.`,
						},
					],
				};
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(page, null, 2),
					},
				],
			};
		},
	);

	// -------------------------------------------------------------------------
	// Tool: list_wiki_pages
	// -------------------------------------------------------------------------

	server.registerTool(
		"list_wiki_pages",
		{
			title: "List Wiki Pages",
			description:
				"List all wiki pages, optionally filtered by tag. Use this to browse " +
				"existing coverage and identify gaps before synthesizing new pages.",
			inputSchema: {
				tag: z.string().optional().describe("Filter wiki pages by this tag"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe("Maximum number of pages to return (default: all)"),
				offset: z
					.number()
					.int()
					.min(0)
					.optional()
					.describe("Number of pages to skip for pagination (default: 0)"),
			},
		},
		async ({ tag, limit, offset }) => {
			const pages = await wikiRepo.list(
				tag || limit !== undefined || offset !== undefined
					? { tag, limit, offset }
					: undefined,
			);

			if (pages.length === 0) {
				return {
					content: [{ type: "text", text: "The wiki is empty." }],
				};
			}

			const summary = pages.map((p) => ({
				slug: p.slug,
				title: p.title,
				tags: p.tags,
				updatedAt: p.updatedAt,
			}));

			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	// -------------------------------------------------------------------------
	// Tool: search_wiki
	// -------------------------------------------------------------------------

	server.registerTool(
		"search_wiki",
		{
			title: "Search Wiki",
			description:
				"Search wiki pages by semantic similarity. Returns matching pages ranked by " +
				"relevance. If no results, the concept likely has no wiki page yet — flag " +
				"this gap to the user.",
			inputSchema: {
				query: z.string().describe("Natural language search query"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(10)
					.optional()
					.describe("Maximum number of results to return (default: 5)"),
				tag: z
					.string()
					.optional()
					.describe("Restrict results to wiki pages with this tag"),
			},
		},
		async ({ query, limit, tag }) => {
			const embedding = await embedder.embed(query);
			const results = await wikiRepo.search({
				embedding,
				limit: limit ?? 5,
				tag,
			});

			if (results.length === 0) {
				// Not isError — absence of results is meaningful signal for gap detection
				return {
					content: [
						{
							type: "text",
							text:
								"No wiki pages found matching your query. The wiki may not yet cover " +
								"this topic — consider using create_wiki_page to synthesize one.",
						},
					],
				};
			}

			// Return summary only; the LLM should call get_wiki_page for full content
			const summary = results.map((r) => ({
				slug: r.slug,
				title: r.title,
				tags: r.tags,
				updatedAt: r.updatedAt,
				similarity: r.similarity,
			}));

			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	// -------------------------------------------------------------------------

	return server;
}
