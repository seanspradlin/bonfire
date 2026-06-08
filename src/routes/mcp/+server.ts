import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { eq } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { baseURL } from '@/auth';
import { db } from '@/db';
import { user } from '@/db/schema';
import { createServer } from '@/modules/mcp/tools';
import { repo, embedder, vision, reranker, storage, wikiRepo } from '$lib/server/deps';
import type { RequestHandler } from './$types';

// ---------------------------------------------------------------------------
// Session management
//
// Each MCP client gets its own WebStandardStreamableHTTPServerTransport
// instance keyed by mcp-session-id header. Sessions share the same
// repository and embedding provider singletons.
//
// Idle sessions are reaped after SESSION_IDLE_TIMEOUT_MS to bound memory —
// clients that disconnect without a clean close would otherwise leak
// a transport + McpServer per attempt.
// ---------------------------------------------------------------------------

const SESSION_IDLE_TIMEOUT_MS = 12 * 60 * 60_000;
const SESSION_MAX_AGE_MS = 24 * 60 * 60_000;
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

const deps = { repo, embedder, vision, reranker, storage, wikiRepo };

/**
 * Route to an existing session by session ID.
 * Used by GET, DELETE, and POST (when session ID is provided).
 */
async function routeToExistingSession(request: Request): Promise<Response> {
	const sessionId = request.headers.get('mcp-session-id');
	if (!sessionId) {
		return new Response(JSON.stringify({ error: 'Session ID required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

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

/**
 * Initialize a new MCP session with JWT authentication.
 * Creates a new transport, McpServer, and session entry.
 */
async function initializeNewSession(request: Request): Promise<Response> {
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

	// Resolve the caller's role so the tool layer can authorize writes/deletes.
	const [account] = await db
		.select({ role: user.role })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	if (!account) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const userRole = account.role ?? null;

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

	const server = createServer({ ...deps, userId, userRole });
	await server.connect(transport);

	return transport.handleRequest(request);
}

/** Route to existing session (session ID required). */
export const GET: RequestHandler = ({ request }) => routeToExistingSession(request);

/** Route to existing session or initialize new session (with JWT). */
export const POST: RequestHandler = async ({ request }) => {
	const sessionId = request.headers.get('mcp-session-id');
	return sessionId ? routeToExistingSession(request) : initializeNewSession(request);
};

/** Route to existing session (session ID required). */
export const DELETE: RequestHandler = ({ request }) => routeToExistingSession(request);
