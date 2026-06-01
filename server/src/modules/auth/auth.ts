import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, jwt, username } from "better-auth/plugins";
import { db } from "@/modules/db";
import {
	account,
	jwks,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken,
	session,
	user,
	verification,
} from "@/modules/db/schema";
import { getResendClient } from "@/modules/email/resend";

export const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

// Loopback URL the server uses to reach its OWN auth endpoints (e.g. the JWKS
// fetch during MCP token verification). In containerized deployments the public
// baseURL (the Caddy entry point) isn't reachable from inside the container, so
// this must point at the server's own listen address. Falls back to baseURL for
// single-process deployments where the public URL is locally reachable.
export const internalBaseURL = process.env.INTERNAL_AUTH_URL ?? baseURL;

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: {
			user,
			session,
			account,
			verification,
			jwks,
			oauthClient,
			oauthRefreshToken,
			oauthAccessToken,
			oauthConsent,
		},
	}),
	baseURL,
	basePath: "/auth",
	trustedOrigins: [baseURL, "http://localhost:5173"],
	emailAndPassword: {
		enabled: true,
		autoSignIn: false,
		minPasswordLength: 8,
		resetPasswordTokenExpiresIn: 60 * 60 * 6,
		sendResetPassword: async ({ user, url }) => {
			const resend = getResendClient();
			if (!resend) {
				console.warn(
					"RESEND_API_KEY not set — skipping password reset email for",
					user.email,
				);
				return;
			}
			const { error } = await resend.emails.send({
				from: process.env.EMAIL_FROM ?? "Bonfire <noreply@example.com>",
				to: user.email,
				subject: "Reset your Bonfire password",
				text: `You requested a password reset.\n\nReset your password here:\n${url}\n\nThis link expires in 6 hours. If you didn't request this, you can ignore this email.`,
			});
			if (error) {
				console.error("Failed to send password reset email:", error);
			}
		},
	},
	plugins: [
		username({
			minUsernameLength: 3,
			maxUsernameLength: 30,
		}),
		admin(),
		jwt(),
		oauthProvider({
			loginPage: "/login",
			consentPage: "/consent",
			// Required for MCP clients (Claude Code, Cursor, etc.) to self-register via
			// RFC 7591 dynamic registration without a pre-provisioned admin token.
			// Risk: any actor can register a client with arbitrary redirect_uris.
			// @better-auth/oauth-provider v1.6.9 has no allowedRedirectUriPatterns option;
			// custom validation would require intercepting POST /auth/oauth2/register with
			// middleware. Accepted for now — Bonfire is a team-internal tool and all users
			// are trusted members who must authenticate before consenting.
			allowDynamicClientRegistration: true,
			allowUnauthenticatedClientRegistration: true,
			scopes: ["openid", "profile", "email", "offline_access"],
			validAudiences: [baseURL, `${baseURL}/mcp`],
		}),
	],
});

export type AuthInstance = typeof auth;

export type AuthSession = typeof auth.$Infer.Session;

export async function getSessionFromHeaders(headers: Headers) {
	return auth.api.getSession({ headers });
}
