import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { type EmbeddingProvider } from "./embeddings.ts";
import { type DocumentRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------

function createServer(
	repo: DocumentRepository,
	embedder: EmbeddingProvider,
): McpServer {
	const server = new McpServer({
		name: "bonfire",
		version: "0.1.0",
	});

	// -------------------------------------------------------------------------
	// Tool: add_document
	// -------------------------------------------------------------------------

	server.tool(
		"add_document",
		"Add a new knowledge base document or update an existing one. " +
			"Accepts markdown content. Provide `id` to update an existing document.",
		{
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
		async ({ title, content, tags, id }) => {
			const embedding = await embedder.embed(`${title}\n\n${content}`);
			const doc = await repo.upsert({ id, title, content, tags, embedding });

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{ id: doc.id, title: doc.title, tags: doc.tags, createdAt: doc.createdAt, updatedAt: doc.updatedAt },
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

	server.tool(
		"search_documents",
		"Search the knowledge base using natural language. Returns the most " +
			"semantically relevant documents ranked by similarity score.",
		{
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
		},
		async ({ query, limit, tag }) => {
			const embedding = await embedder.embed(query);
			const results = await repo.search({ embedding, limit, tag });

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

	server.tool(
		"get_document",
		"Retrieve the full content of a document by its ID.",
		{
			id: z.string().describe("Document ID"),
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

	server.tool(
		"list_documents",
		"List all documents in the knowledge base. Optionally filter by tag.",
		{
			tag: z
				.string()
				.optional()
				.describe("Filter documents by this tag"),
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
	// Tool: delete_document
	// -------------------------------------------------------------------------

	server.tool(
		"delete_document",
		"Permanently delete a document from the knowledge base.",
		{
			id: z.string().describe("Document ID to delete"),
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
) {
	const sessions = new Map<
		string,
		WebStandardStreamableHTTPServerTransport
	>();

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
				JSON.stringify({ error: "Send a POST initialize request to start a session" }),
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

		const server = createServer(repo, embedder);
		await server.connect(transport);

		return transport.handleRequest(req);
	};
}
