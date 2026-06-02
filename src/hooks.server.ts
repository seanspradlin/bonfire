import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { auth, baseURL } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import {
	oauthProviderAuthServerMetadata,
	oauthProviderOpenIdConfigMetadata
} from '@better-auth/oauth-provider';

// ---------------------------------------------------------------------------
// One-shot seed guard — runs once per process lifetime, not on every request
// ---------------------------------------------------------------------------

let seeded = false;

async function maybeSeeed() {
	if (seeded || building) return;
	seeded = true;
	try {
		const { seedInitialAdminUser } = await import('@/modules/auth/seed');
		await seedInitialAdminUser();
	} catch (err) {
		console.warn('[hooks] seed failed (non-fatal):', err);
	}
}

// ---------------------------------------------------------------------------
// .well-known OAuth/OIDC metadata handler
//
// RFC 8414 mandates these endpoints so MCP clients can perform discovery.
// We intercept them before the SvelteKit router because SvelteKit doesn't
// naturally route dot-prefixed path segments.
//
// Three paths are served:
//   /.well-known/openid-configuration          — OIDC discovery
//   /.well-known/oauth-authorization-server     — bare OAuth AS metadata
//   /.well-known/oauth-authorization-server/api/auth
//                                              — path-based discovery for
//                                                issuer https://<host>/api/auth
//   /.well-known/oauth-protected-resource       — resource server metadata
// ---------------------------------------------------------------------------

async function handleWellKnown(request: Request): Promise<Response | null> {
	const url = new URL(request.url);
	const path = url.pathname;

	if (path === '/.well-known/openid-configuration') {
		return oauthProviderOpenIdConfigMetadata(auth)(request);
	}

	if (
		path === '/.well-known/oauth-authorization-server' ||
		path === '/.well-known/oauth-authorization-server/api/auth'
	) {
		return oauthProviderAuthServerMetadata(auth)(request);
	}

	if (path === '/.well-known/oauth-protected-resource') {
		return new Response(
			JSON.stringify({
				resource: `${baseURL}/mcp`,
				authorization_servers: [`${baseURL}/api/auth`],
				bearer_methods_supported: ['header']
			}),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	}

	return null;
}

// ---------------------------------------------------------------------------
// Main hook — session population + auth handler
// ---------------------------------------------------------------------------

export const handle: Handle = async ({ event, resolve }) => {
	// Seed on first request so the admin user exists before any real traffic.
	await maybeSeeed();

	// Short-circuit .well-known requests before they reach the router.
	const wellKnownResponse = await handleWellKnown(event.request);
	if (wellKnownResponse) return wellKnownResponse;

	// Populate event.locals with the session from the incoming request headers.
	// Errors here are expected for OAuth Bearer tokens — those are not session
	// tokens, so we silently fall through with no session.
	try {
		const session = await auth.api.getSession({ headers: event.request.headers });
		if (session) {
			event.locals.session = session.session;
			event.locals.user = session.user;
		}
	} catch {
		// Not a session token (e.g. Bearer JWT for MCP) — ignore.
	}

	return svelteKitHandler({ event, resolve, auth, building });
};
