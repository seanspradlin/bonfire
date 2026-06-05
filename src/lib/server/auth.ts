import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { admin, jwt, username } from 'better-auth/plugins';
import { sql } from 'drizzle-orm';
import { building } from '$app/environment';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import {
	account,
	invitations,
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

function resolveBetterAuthSecret() {
	const secret = env.BETTER_AUTH_SECRET?.trim();
	if (secret) return secret;
	if (building) return 'build-only-better-auth-secret-placeholder';
	throw new Error('BETTER_AUTH_SECRET is not set');
}

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
	secret: resolveBetterAuthSecret(),
	hooks: {
		// Sign-up is invitation-only. Email/password sign-up must stay enabled so
		// the invitation-accept flow (auth.api.signUpEmail) works, but we reject
		// any sign-up whose email has no matching invitation row. Admins create
		// invitations via POST /api/invitations, so this restricts account
		// creation to people an admin has explicitly invited.
		before: createAuthMiddleware(async (ctx) => {
			if (ctx.path !== '/sign-up/email') return;

			const email = typeof ctx.body?.email === 'string' ? ctx.body.email.trim() : '';
			if (!email) {
				throw new APIError('BAD_REQUEST', { message: 'Email is required' });
			}

			// Allow the dev seed admin to bootstrap. This mirrors the exact guards
			// in seedInitialAdminUser (non-production + SEED_ADMIN_PASSWORD set), so
			// the exemption only exists for the one operator-configured email in the
			// one environment where seeding actually runs. No exemption in production.
			const seedActive = env.NODE_ENV !== 'production' && Boolean(env.SEED_ADMIN_PASSWORD);
			const seedEmail = (env.SEED_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
			if (seedActive && email.toLowerCase() === seedEmail) return;

			// Require a still-valid invitation: matching email, not yet accepted, and
			// not expired. The accept-invite flow marks acceptedAt inside an uncommitted
			// transaction on a separate connection, so this read still sees the
			// invitation as valid while signUpEmail runs.
			const [invite] = await db
				.select({ id: invitations.id })
				.from(invitations)
				.where(
					sql`lower(${invitations.email}) = lower(${email}) and ${invitations.acceptedAt} is null and ${invitations.expiresAt} > now()`
				)
				.limit(1);

			if (!invite) {
				throw new APIError('FORBIDDEN', {
					message: 'Sign-up is by invitation only with a valid invitation.',
					code: 'SIGN_UP_BY_INVITATION_ONLY'
				});
			}
		})
	},
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
