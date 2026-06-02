import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { admin, jwt, username } from 'better-auth/plugins';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import {
	account,
	jwks,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken,
	session,
	user,
	verification
} from '$lib/server/db/schema';

// The canonical server origin — used as the issuer for JWTs and the base URL
// for all Better Auth endpoints. Falls back to localhost for dev convenience.
export const baseURL = env.ORIGIN ?? env.BETTER_AUTH_URL ?? 'http://localhost:5173';

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'pg',
		schema: {
			user,
			session,
			account,
			verification,
			jwks,
			oauthClient,
			oauthRefreshToken,
			oauthAccessToken,
			oauthConsent
		}
	}),
	baseURL,
	// All auth endpoints live under /api/auth so the client's basePath matches.
	basePath: '/api/auth',
	trustedOrigins: [baseURL, env.CLIENT_URL ?? 'http://localhost:5173'].filter(Boolean),
	secret: env.BETTER_AUTH_SECRET,
	emailAndPassword: {
		enabled: true,
		autoSignIn: false,
		minPasswordLength: 8,
		resetPasswordTokenExpiresIn: 60 * 60 * 6,
		sendResetPassword: async ({ user: u, url }) => {
			// Lazy-import to avoid requiring RESEND_API_KEY at module load time.
			const { getResendClient } = await import('@/modules/email/resend');
			const resend = getResendClient();
			if (!resend) {
				console.warn('RESEND_API_KEY not set — skipping password reset email for', u.email);
				return;
			}
			const { error } = await resend.emails.send({
				from: env.EMAIL_FROM ?? 'Bonfire <noreply@example.com>',
				to: u.email,
				subject: 'Reset your Bonfire password',
				text: `You requested a password reset.\n\nReset your password here:\n${url}\n\nThis link expires in 6 hours. If you didn't request this, you can ignore this email.`
			});
			if (error) {
				console.error('Failed to send password reset email:', error);
			}
		}
	},
	plugins: [
		username({
			minUsernameLength: 3,
			maxUsernameLength: 30
		}),
		admin(),
		jwt(),
		oauthProvider({
			loginPage: '/login',
			consentPage: '/consent',
			// Required for MCP clients (Claude Code, Cursor, etc.) to self-register via
			// RFC 7591 dynamic registration without a pre-provisioned admin token.
			// Risk: any actor can register a client with arbitrary redirect_uris.
			// Accepted for now — Bonfire is a team-internal tool and all users are trusted.
			allowDynamicClientRegistration: true,
			allowUnauthenticatedClientRegistration: true,
			scopes: ['openid', 'profile', 'email', 'offline_access'],
			validAudiences: [baseURL, `${baseURL}/mcp`]
		}),
		// sveltekitCookies MUST be the last plugin in the array
		sveltekitCookies(getRequestEvent)
	]
});

export type AuthInstance = typeof auth;
export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = AuthSession['user'];
export type SessionData = AuthSession['session'];

export async function getSessionFromHeaders(headers: Headers) {
	return auth.api.getSession({ headers });
}
