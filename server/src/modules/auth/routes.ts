import {
	oauthProviderAuthServerMetadata,
	oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { auth, baseURL } from "@/modules/auth/auth";
import { requireAuth } from "@/modules/auth/middleware";
import { db } from "@/modules/db/db";
import { oauthClient } from "@/modules/db/schema";

/**
 * Mounts Better Auth's handler and API token management routes.
 */
export function createAuthRouter() {
	const router = new Hono();

	/**
	 * Change the authenticated user's password.
	 * Delegates to Better Auth's built-in changePassword handler.
	 */
	router.post("/auth/password", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;

		let body: { currentPassword: string; newPassword: string };
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		const { currentPassword, newPassword } = body;
		if (!currentPassword || !newPassword) {
			return c.json(
				{ error: "currentPassword and newPassword are required" },
				400,
			);
		}
		if (newPassword.length < 8) {
			return c.json(
				{ error: "New password must be at least 8 characters" },
				400,
			);
		}

		try {
			await auth.api.changePassword({
				body: { currentPassword, newPassword, revokeOtherSessions: false },
				headers: c.req.raw.headers,
			});
			return c.json({ success: true });
		} catch (err) {
			console.error("Failed to change password:", err);
			return c.json({ error: "Internal server error" }, 500);
		}
	});

	router.on(["GET", "POST"], "/auth/*", (c) => {
		return auth.handler(c.req.raw);
	});

	router.get("/oauth/clients/:clientId", async (c) => {
		const clientId = c.req.param("clientId");
		const [client] = await db
			.select({ name: oauthClient.name })
			.from(oauthClient)
			.where(eq(oauthClient.clientId, clientId))
			.limit(1);
		if (!client) return c.json({ error: "Not found" }, 404);
		return c.json({ name: client.name });
	});

	router.get("/.well-known/openid-configuration", (c) =>
		oauthProviderOpenIdConfigMetadata(auth)(c.req.raw),
	);

	// RFC 8414: bare path for clients that don't use path-based discovery
	router.get("/.well-known/oauth-authorization-server", (c) =>
		oauthProviderAuthServerMetadata(auth)(c.req.raw),
	);

	// RFC 8414: path-based discovery for issuer https://<host>/auth
	router.get("/.well-known/oauth-authorization-server/auth", (c) =>
		oauthProviderAuthServerMetadata(auth)(c.req.raw),
	);

	router.get("/.well-known/oauth-protected-resource", (c) => {
		return c.json({
			resource: `${baseURL}/mcp`,
			authorization_servers: [`${baseURL}/auth`],
			bearer_methods_supported: ["header"],
		});
	});

	return router;
}
