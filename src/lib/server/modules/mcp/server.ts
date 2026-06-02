import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { baseURL } from '@/auth';
import { createServer, type SharedDeps } from '@/modules/mcp/tools';

// ---------------------------------------------------------------------------
// Session management
//
// Each MCP client gets its own WebStandardStreamableHTTPServerTransport
// instance keyed by mcp-session-id header. Sessions share the same
// repository and embedding provider singletons passed in via `deps`.
//
// Idle sessions are reaped after SESSION_IDLE_TIMEOUT_MS to bound memory —
// clients that disconnect without a clean close (browser tab killed, laptop
// sleep, network drop) would otherwise leak a transport + McpServer per try.
// ---------------------------------------------------------------------------

const SESSION_IDLE_TIMEOUT_MS = 15 * 60_000;
const SESSION_MAX_AGE_MS = 4 * 60 * 60_000;
const SESSION_SWEEP_INTERVAL_MS = 60_000;

interface SessionEntry {
	transport: WebStandardStreamableHTTPServerTransport;
	lastActivityAt: number;
	createdAt: number;
}

const sessions = new Map<string, SessionEntry>();

// The JWKS endpoint lives at /api/auth/jwks because basePath is /api/auth.
const jwks = createRemoteJWKSet(new URL(`${baseURL}/api/auth/jwks`));

// Sweep stale sessions on a fixed interval. `.unref()` ensures the timer
// doesn't prevent process shutdown.
setInterval(() => {
	const now = Date.now();
	const idleCutoff = now - SESSION_IDLE_TIMEOUT_MS;
	const ageCutoff = now - SESSION_MAX_AGE_MS;
	for (const [sid, entry] of sessions) {
		if (entry.lastActivityAt < idleCutoff || entry.createdAt < ageCutoff) {
			sessions.delete(sid);
			entry.transport.close().catch((error) => {
				console.warn('Failed to close evicted MCP session transport', {
					sessionId: sid,
					error
				});
			});
		}
	}
}, SESSION_SWEEP_INTERVAL_MS).unref();

/**
 * Handle a single MCP HTTP request.
 *
 * Routing logic:
 * - If the request carries a valid mcp-session-id header, route to the
 *   existing transport without re-verifying the JWT (the session ID is the
 *   credential for subsequent requests; re-verification would evict clients
 *   on token expiry even though their session remains active).
 * - New sessions (no session ID) must be POST requests with a valid Bearer JWT.
 *   On success a new McpServer + transport is created and registered.
 */
export async function handleMcpRequest(request: Request, deps: SharedDeps): Promise<Response> {
	const sessionId = request.headers.get('mcp-session-id');

	// Route to an existing session.
	if (sessionId) {
		const entry = sessions.get(sessionId);
		if (!entry) {
			return new Response(JSON.stringify({ error: 'Session not found or expired' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		entry.lastActivityAt = Date.now();
		return entry.transport.handleRequest(request);
	}

	// New session — only allow on POST (initialize requests).
	if (request.method !== 'POST') {
		return new Response(
			JSON.stringify({ error: 'Send a POST initialize request to start a session' }),
			{ status: 400, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// Require a valid Bearer JWT to establish identity.
	const authHeader = request.headers.get('authorization');
	if (!authHeader?.startsWith('Bearer ')) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: {
				'Content-Type': 'application/json',
				'WWW-Authenticate': `Bearer resource_metadata="${baseURL}/.well-known/oauth-protected-resource"`
			}
		});
	}

	const token = authHeader.slice(7);
	let userId: string | null = null;
	try {
		const { payload } = await jwtVerify(token, jwks, {
			// issuer must match the Better Auth basePath issuer
			issuer: `${baseURL}/api/auth`,
			audience: `${baseURL}/mcp`
		});
		if (payload.sub) userId = payload.sub;
	} catch (err) {
		console.warn('MCP JWT verification failed', { error: err });
	}

	if (!userId) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: {
				'Content-Type': 'application/json',
				'WWW-Authenticate': `Bearer resource_metadata="${baseURL}/.well-known/oauth-protected-resource"`
			}
		});
	}

	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: () => crypto.randomUUID(),
		onsessioninitialized: (sid) => {
			const now = Date.now();
			sessions.set(sid, { transport, lastActivityAt: now, createdAt: now });
			const forwarded = request.headers.get('x-forwarded-for');
			const clientIp =
				forwarded?.split(',')[0]?.trim() ||
				request.headers.get('cf-connecting-ip') ||
				request.headers.get('x-real-ip') ||
				null;
			console.info('MCP session opened', {
				sessionId: sid,
				userId,
				userAgent: request.headers.get('user-agent'),
				protocolVersion: request.headers.get('mcp-protocol-version'),
				clientIp,
				activeSessions: sessions.size
			});
		},
		onsessionclosed: (sid) => {
			sessions.delete(sid);
		}
	});

	const server = createServer({ ...deps, userId });
	await server.connect(transport);

	return transport.handleRequest(request);
}
