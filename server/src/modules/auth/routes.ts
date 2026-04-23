import { Hono } from "hono";
import {
	createApiKey,
	deleteApiKey,
	listApiKeys,
} from "@/modules/auth/apiKeys";
import { auth } from "@/modules/auth/auth";
import { requireAuth } from "@/modules/auth/middleware";

/**
 * Mounts Better Auth's handler and API token management routes.
 */
export function createAuthRouter() {
	const router = new Hono();

	/**
	 * List all API tokens for the authenticated user.
	 * Returns masked display strings — plaintext keys are never returned after creation.
	 */
	router.get("/auth/tokens", async (c) => {
		const user = requireAuth(c);
		if (user instanceof Response) return user;

		const keys = await listApiKeys(user.id);
		return c.json({ keys });
	});

	/**
	 * Create a new API token.
	 * Returns the plaintext key once alongside the masked display string.
	 */
	router.post("/auth/tokens", async (c) => {
		const user = requireAuth(c);
		if (user instanceof Response) return user;

		let body: { name: string };
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
			return c.json({ error: "Name is required" }, 400);
		}

		const result = await createApiKey(user.id, body.name.trim());

		return c.json(
			{
				id: result.id,
				key: result.key,
				masked: result.masked,
				warning:
					"Save this key securely. It will not be shown again and cannot be recovered.",
			},
			201,
		);
	});

	/**
	 * Delete an API token. Scoped to the authenticated user so users can only
	 * revoke their own tokens.
	 */
	router.delete("/auth/tokens/:id", async (c) => {
		const user = requireAuth(c);
		if (user instanceof Response) return user;

		const keyId = c.req.param("id");
		const deleted = await deleteApiKey(keyId, user.id);

		if (!deleted) {
			return c.json({ error: "API token not found" }, 404);
		}

		return c.json({ success: true });
	});

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

	return router;
}
