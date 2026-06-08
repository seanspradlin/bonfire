import { sequence } from '@sveltejs/kit/hooks';
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

const handleSeed: Handle = async ({ event, resolve }) => {
	if (!seeded && !building) {
		seeded = true;
		try {
			const { seedInitialAdminUser } = await import('@/modules/auth/seed');
			await seedInitialAdminUser();
		} catch (err) {
			console.warn('[hooks] seed failed (non-fatal):', err);
		}
	}
	return resolve(event);
};

// ---------------------------------------------------------------------------
// .well-known OAuth/OIDC metadata
//
// RFC 8414 mandates these endpoints for MCP client discovery. SvelteKit
// doesn't route dot-prefixed path segments, so we intercept them here.
// ---------------------------------------------------------------------------

const handleWellKnown: Handle = async ({ event, resolve }) => {
	const { pathname } = new URL(event.request.url);

	if (pathname === '/.well-known/openid-configuration') {
		return oauthProviderOpenIdConfigMetadata(auth)(event.request);
	}

	if (
		pathname === '/.well-known/oauth-authorization-server' ||
		pathname === '/.well-known/oauth-authorization-server/api/auth'
	) {
		return oauthProviderAuthServerMetadata(auth)(event.request);
	}

	if (
		pathname === '/.well-known/oauth-protected-resource' ||
		pathname === '/.well-known/oauth-protected-resource/mcp'
	) {
		return new Response(
			JSON.stringify({
				resource: `${baseURL}/mcp`,
				authorization_servers: [`${baseURL}/api/auth`],
				bearer_methods_supported: ['header']
			}),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	}

	return resolve(event);
};

// ---------------------------------------------------------------------------
// Session population
//
// Errors here are expected for OAuth Bearer tokens (JWT for MCP) — those are
// not session tokens, so we silently fall through with no session populated.
// ---------------------------------------------------------------------------

const handleSession: Handle = async ({ event, resolve }) => {
	try {
		const session = await auth.api.getSession({ headers: event.request.headers });
		if (session) {
			event.locals.user = session.user;
			event.locals.session = session.session;
		}
	} catch {
		// Not a session token (e.g. Bearer JWT for MCP) — ignore.
	}
	return resolve(event);
};

// ---------------------------------------------------------------------------
// Better Auth request handler
// ---------------------------------------------------------------------------

const handleAuth: Handle = ({ event, resolve }) =>
	svelteKitHandler({ event, resolve, auth, building });

export const handle = sequence(handleSeed, handleWellKnown, handleSession, handleAuth);
