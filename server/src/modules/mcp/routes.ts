import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { authenticateApiKey } from "@/modules/auth";
import { createServer, type SharedDeps } from "@/modules/mcp/tools";

// ---------------------------------------------------------------------------
// Session management + Hono router
// ---------------------------------------------------------------------------

const SESSION_IDLE_TIMEOUT_MS = 15 * 60_000;
const SESSION_MAX_AGE_MS = 4 * 60 * 60_000;
const SESSION_SWEEP_INTERVAL_MS = 60_000;

interface SessionEntry {
	transport: WebStandardStreamableHTTPServerTransport;
	ownerId: string;
	lastActivityAt: number;
	createdAt: number;
}

/**
 * Builds the MCP Hono router. Manages per-session transports internally so
 * each connecting client gets its own McpServer instance while sharing the
 * same underlying repository and embedding provider singletons.
 *
 * Idle sessions are reaped after `SESSION_IDLE_TIMEOUT_MS` to bound memory —
 * clients that disconnect without a clean close (browser tab killed, laptop
 * sleep, network drop) would otherwise leak a transport + McpServer per try.
 */
export function createMcpRouter(deps: SharedDeps) {
	const router = new Hono<{
		Variables: {
			user: { id: string } | null;
			session: unknown | null;
		};
	}>();
	const sessions = new Map<string, SessionEntry>();

	setInterval(() => {
		const now = Date.now();
		const idleCutoff = now - SESSION_IDLE_TIMEOUT_MS;
		const ageCutoff = now - SESSION_MAX_AGE_MS;
		for (const [sid, entry] of sessions) {
			if (entry.lastActivityAt < idleCutoff || entry.createdAt < ageCutoff) {
				sessions.delete(sid);
				entry.transport.close().catch((error) => {
					console.warn("Failed to close evicted MCP session transport", {
						sessionId: sid,
						ownerId: entry.ownerId,
						error,
					});
				});
			}
		}
	}, SESSION_SWEEP_INTERVAL_MS).unref();

	/**
	 * Handles a raw MCP protocol request, routing it to an existing session or
	 * initializing a new one on POST.
	 */
	async function handleMcpRequest(
		req: Request,
		userId: string,
		authMethod: "api-key" | "session",
	): Promise<Response> {
		const sessionId = req.headers.get("mcp-session-id");

		// Route to existing session
		if (sessionId) {
			const entry = sessions.get(sessionId);
			if (!entry) {
				return new Response(
					JSON.stringify({ error: "Session not found or expired" }),
					{ status: 404, headers: { "Content-Type": "application/json" } },
				);
			}
			if (entry.ownerId !== userId) {
				return new Response(JSON.stringify({ error: "Forbidden" }), {
					status: 403,
					headers: { "Content-Type": "application/json" },
				});
			}
			entry.lastActivityAt = Date.now();
			return entry.transport.handleRequest(req);
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
				const now = Date.now();
				sessions.set(sid, {
					transport,
					ownerId: userId,
					lastActivityAt: now,
					createdAt: now,
				});
				const forwarded = req.headers.get("x-forwarded-for");
				const clientIp =
					forwarded?.split(",")[0]?.trim() ||
					req.headers.get("cf-connecting-ip") ||
					req.headers.get("x-real-ip") ||
					null;
				console.log("MCP session opened", {
					sessionId: sid,
					userId,
					authMethod,
					userAgent: req.headers.get("user-agent"),
					protocolVersion: req.headers.get("mcp-protocol-version"),
					clientIp,
					activeSessions: sessions.size,
				});
			},
			onsessionclosed: (sid) => {
				sessions.delete(sid);
			},
		});

		const server = createServer({ ...deps, userId });
		await server.connect(transport);

		return transport.handleRequest(req);
	}

	router.get("/mcp/sessions", (c) => {
		const user = c.get("user");
		if (!user) return c.json({ error: "Unauthorized" }, 401);
		return c.json({ count: sessions.size });
	});

	/** MCP Streamable HTTP endpoint — handles all MCP protocol traffic */
	router.all("/mcp", async (c) => {
		let userId: string | null = null;
		let authMethod: "api-key" | "session" | null = null;

		// Try API key authentication first
		const authHeader = c.req.header("authorization");
		if (authHeader?.startsWith("Bearer ")) {
			const apiKey = authHeader.slice(7);
			userId = await authenticateApiKey(apiKey);
			if (userId) authMethod = "api-key";
		}

		// Fall back to session authentication
		if (!userId) {
			const user = c.get("user");
			if (user) {
				userId = user.id;
				authMethod = "session";
			}
		}

		// If both auth methods failed, return 401
		if (!userId || !authMethod) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		return handleMcpRequest(c.req.raw, userId, authMethod);
	});

	return router;
}
