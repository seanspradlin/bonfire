import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { EmbeddingProvider } from "./embeddings";
import type { DocumentRepository } from "./repository";
import type { VisionProvider } from "./vision";

// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------

function createServer(
	repo: DocumentRepository,
	embedder: EmbeddingProvider,
	vision: VisionProvider,
): McpServer {
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
				id: z
					.string()
					.optional()
					.describe("Document ID — omit to create a new document"),
			},
		},
		async ({ title, content, tags, id }) => {
			const embedding = await embedder.embed(`${title}\n\n${content}`);
			const doc = await repo.upsert({ id, title, content, tags, embedding });

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								id: doc.id,
								title: doc.title,
								tags: doc.tags,
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
				since: z
					.string()
					.datetime()
					.optional()
					.describe("ISO 8601 timestamp — only return documents updated at or after this time"),
				before: z
					.string()
					.datetime()
					.optional()
					.describe("ISO 8601 timestamp — only return documents updated before this time"),
			},
		},
		async ({ query, limit, tag, since, before }) => {
			const embedding = await embedder.embed(query);
			const results = await repo.search({ embedding, limit, tag, since, before });

			if (results.length === 0) {
				return {
					content: [{ type: "text", text: "No matching documents found." }],
				};
			}

			const formatted = results.map((r) => ({
				id: r.id,
				title: r.title,
				tags: r.tags,
				similarity: Math.round(r.similarity * 1000) / 1000,
				content: r.content,
			}));

			return {
				content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
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

			return {
				content: [{ type: "text", text: JSON.stringify(doc, null, 2) }],
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
					.describe("Maximum number of documents to return after merging (default: 8)"),
				tag: z
					.string()
					.optional()
					.describe("Restrict results to documents with this tag"),
				since: z
					.string()
					.datetime()
					.optional()
					.describe("ISO 8601 timestamp — only return documents updated at or after this time"),
				before: z
					.string()
					.datetime()
					.optional()
					.describe("ISO 8601 timestamp — only return documents updated before this time"),
			},
		},
		async ({ question, extra_queries, limit, tag, since, before }) => {
			const queries = [question, ...(extra_queries ?? [])];
			const perQueryLimit = Math.min(20, (limit ?? 8) + 2);

			const allResults = await Promise.all(
				queries.map(async (q) => {
					const embedding = await embedder.embed(q);
					return repo.search({ embedding, limit: perQueryLimit, tag, since, before });
				}),
			);

			// Deduplicate by ID, keeping the highest similarity score seen
			const best = new Map<string, (typeof allResults)[0][0]>();
			for (const results of allResults) {
				for (const doc of results) {
					const existing = best.get(doc.id);
					if (!existing || doc.similarity > existing.similarity) {
						best.set(doc.id, doc);
					}
				}
			}

			const merged = Array.from(best.values())
				.sort((a, b) => b.similarity - a.similarity)
				.slice(0, limit ?? 8);

			if (merged.length === 0) {
				return {
					content: [{ type: "text", text: "No relevant documents found." }],
				};
			}

			const formatted = merged.map((r) => ({
				id: r.id,
				title: r.title,
				tags: r.tags,
				similarity: Math.round(r.similarity * 1000) / 1000,
				content: r.content,
			}));

			return {
				content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
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
					.optional()
					.describe("Document ID — omit to create a new document"),
				context: z
					.string()
					.optional()
					.describe(
						"Optional hint about the image content to guide analysis " +
							"(e.g. 'whiteboard from sprint planning meeting on 2026-04-17')",
					),
			},
		},
		async ({ image_data, media_type, title, tags, id, context }) => {
			const result = await vision.analyzeImage(
				{ data: image_data, mediaType: media_type },
				{ title, context },
			);

			const resolvedTitle = title ?? result.title;
			const resolvedTags = tags ?? result.tags;
			const embedding = await embedder.embed(`${resolvedTitle}\n\n${result.content}`);
			const doc = await repo.upsert({
				id,
				title: resolvedTitle,
				content: result.content,
				tags: resolvedTags,
				embedding,
			});

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								id: doc.id,
								title: doc.title,
								tags: doc.tags,
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
	// Tool: delete_document
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

// ---------------------------------------------------------------------------
// Session management + Hono handler factory
// ---------------------------------------------------------------------------

/**
 * Returns a Hono-compatible request handler that manages MCP sessions.
 * Each connecting client gets its own transport and McpServer instance,
 * sharing the same underlying repository and embedding provider.
 */
export function createMcpHandler(
	repo: DocumentRepository,
	embedder: EmbeddingProvider,
	vision: VisionProvider,
) {
	const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

	return async (req: Request): Promise<Response> => {
		const sessionId = req.headers.get("mcp-session-id");

		// Route to existing session
		if (sessionId) {
			const transport = sessions.get(sessionId);
			if (!transport) {
				return new Response(
					JSON.stringify({ error: "Session not found or expired" }),
					{ status: 404, headers: { "Content-Type": "application/json" } },
				);
			}
			return transport.handleRequest(req);
		}

		// New session — only allow on POST (initialize requests)
		if (req.method !== "POST") {
			return new Response(
				JSON.stringify({
					error: "Send a POST initialize request to start a session",
				}),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		let transport: WebStandardStreamableHTTPServerTransport;
		transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: () => crypto.randomUUID(),
			onsessioninitialized: (sid) => {
				sessions.set(sid, transport);
			},
			onsessionclosed: (sid) => {
				sessions.delete(sid);
			},
		});

		const server = createServer(repo, embedder, vision);
		await server.connect(transport);

		return transport.handleRequest(req);
	};
}
