import type { Context, MiddlewareHandler } from "hono";
import type { AuthSession } from "@/modules/auth/auth";
import { auth } from "@/modules/auth/auth";

export type AuthUser = AuthSession["user"];
export type SessionData = AuthSession["session"];

/**
 * Populates request context with Better Auth session data for downstream handlers.
 */
export function createAuthSessionMiddleware(): MiddlewareHandler {
	return async (c, next) => {
		let session = null;
		try {
			session = await auth.api.getSession({ headers: c.req.raw.headers });
		} catch {
			// OAuth Bearer tokens are not session tokens; let downstream handlers authenticate them
		}
		c.set("user", session?.user ?? null);
		c.set("session", session?.session ?? null);
		await next();
	};
}

export function requireAuth(c: Context): AuthUser | Response {
	const user = c.get("user");
	if (!user) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	return user;
}

export function isAdmin(user: { role?: string | string[] | null }): boolean {
	if (Array.isArray(user.role)) {
		return user.role.includes("admin");
	}
	if (typeof user.role === "string") {
		return user.role
			.split(",")
			.map((r) => r.trim())
			.includes("admin");
	}
	return false;
}
