import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { authenticateApiKey } from "@/modules/auth";
import { createServer, type SharedDeps } from "@/modules/mcp/tools";

// ---------------------------------------------------------------------------
// Session management + Hono router
// ---------------------------------------------------------------------------

/**
 * Builds the MCP Hono router. Manages per-session transports internally so
 * each connecting client gets its own McpServer instance while sharing the
 * same underlying repository and embedding provider singletons.
 */
export function createMcpRouter(deps: SharedDeps) {
	const router = new Hono<{
		Variables: {
			user: { id: string } | null;
			session: unknown | null;
		};
	}>();
	const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
	const sessionOwners = new Map<string, string>();

	/**
	 * Handles a raw MCP protocol request, routing it to an existing session or
	 * initializing a new one on POST.
	 */
	async function handleMcpRequest(
		req: Request,
		userId: string,
	): Promise<Response> {
		const sessionId = req.headers.get("mcp-session-id");

		// Route to existing session
		if (sessionId) {
			const ownerId = sessionOwners.get(sessionId);
			if (ownerId && ownerId !== userId) {
				return new Response(JSON.stringify({ error: "Forbidden" }), {
					status: 403,
					headers: { "Content-Type": "application/json" },
				});
			}

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
				sessionOwners.set(sid, userId);
			},
			onsessionclosed: (sid) => {
				sessions.delete(sid);
				sessionOwners.delete(sid);
			},
		});

		const server = createServer({ ...deps, userId });
		await server.connect(transport);

		return transport.handleRequest(req);
	}

	/** MCP Streamable HTTP endpoint — handles all MCP protocol traffic */
	router.all("/mcp", async (c) => {
		let userId: string | null = null;

		// Try API key authentication first
		const authHeader = c.req.header("authorization");
		if (authHeader?.startsWith("Bearer ")) {
			const apiKey = authHeader.slice(7);
			userId = await authenticateApiKey(apiKey);
		}

		// Fall back to session authentication
		if (!userId) {
			const user = c.get("user");
			if (user) {
				userId = user.id;
			}
		}

		// If both auth methods failed, return 401
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		return handleMcpRequest(c.req.raw, userId);
	});

	return router;
}
