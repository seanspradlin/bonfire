import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, username } from "better-auth/plugins";
import { db } from "@/modules/db";
import { account, session, user, verification } from "@/modules/db/schema";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: {
			user,
			session,
			account,
			verification,
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
	],
});

export type AuthInstance = typeof auth;

export type AuthSession = typeof auth.$Infer.Session;

export async function getSessionFromHeaders(headers: Headers) {
	return auth.api.getSession({ headers });
}
