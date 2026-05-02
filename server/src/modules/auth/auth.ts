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

export const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

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
