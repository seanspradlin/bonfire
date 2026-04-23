import { and, eq, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { isAdmin, requireAuth } from "@/modules/auth";
import { auth } from "@/modules/auth/auth";
import { db } from "@/modules/db";
import { user } from "@/modules/db/schema";

/** Thrown when a role-change would remove the last admin in the system. */
class LastAdminError extends Error {
	constructor() {
		super("Cannot remove last admin");
	}
}

/**
 * User management routes backed by Better Auth state.
 */
export function createUsersRouter() {
	const router = new Hono();

	router.get("/users/me", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;

		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		if (!session) return c.json({ error: "Unauthorized" }, 401);

		return c.json({ user: session.user, session: session.session });
	});

	router.get("/users", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;
		if (!isAdmin(authUser)) return c.json({ error: "Forbidden" }, 403);

		const result = await auth.api.listUsers({
			headers: c.req.raw.headers,
			query: { limit: 100, offset: 0 },
		});

		return c.json(result);
	});

	router.put("/users/:id/role", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;
		if (!isAdmin(authUser)) return c.json({ error: "Forbidden" }, 403);

		const userId = c.req.param("id");
		let body: { role: string };
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		if (!body.role) {
			return c.json({ error: "Role is required" }, 400);
		}

		const validRoles = ["admin", "editor", "viewer"];
		if (!validRoles.includes(body.role)) {
			return c.json(
				{ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` },
				400,
			);
		}

		// Prevent an admin from accidentally locking themselves out.
		if (userId === authUser.id && body.role !== "admin") {
			return c.json({ error: "Cannot demote yourself" }, 400);
		}

		try {
			/**
			 * Serializable isolation prevents the TOCTOU race where two concurrent
			 * admin-demotion requests both pass the count check and both proceed.
			 * The count and the update are a single atomic unit at this level.
			 */
			const updated = await db.transaction(
				async (tx) => {
					// Verify the target user exists before doing anything else.
					const [targetUser] = await tx
						.select({ role: user.role })
						.from(user)
						.where(eq(user.id, userId))
						.limit(1);

					if (!targetUser) {
						// Signal not-found to the outer catch via a typed error.
						throw Object.assign(new Error("User not found"), {
							code: "USER_NOT_FOUND",
						});
					}

					// Guard: if demoting an admin, ensure at least one other admin remains.
					if (body.role !== "admin") {
						const [{ adminCount }] = await tx
							.select({ adminCount: sql<number>`count(*)::int` })
							.from(user)
							.where(and(eq(user.role, "admin"), ne(user.id, userId)));

						if (adminCount === 0) {
							throw new LastAdminError();
						}
					}

					const rows = await tx
						.update(user)
						.set({ role: body.role, updatedAt: new Date() })
						.where(eq(user.id, userId))
						.returning();

					return rows[0];
				},
				{ isolationLevel: "serializable" },
			);

			return c.json(updated);
		} catch (error) {
			if (error instanceof LastAdminError) {
				return c.json({ error: "Cannot remove last admin" }, 400);
			}
			if (
				error instanceof Error &&
				(error as Error & { code?: string }).code === "USER_NOT_FOUND"
			) {
				return c.json({ error: "User not found" }, 404);
			}
			console.error("Failed to update user role:", error);
			return c.json({ error: "Internal server error" }, 500);
		}
	});

	return router;
}
