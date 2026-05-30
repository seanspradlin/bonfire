import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { isAdmin, requireAuth } from "@/modules/auth";
import { auth } from "@/modules/auth/auth";
import { db } from "@/modules/db";
import { invitations, user } from "@/modules/db/schema";
import { getResendClient } from "@/modules/email/resend";

const createInvitationSchema = z.object({
	email: z.string().email(),
	role: z.enum(["admin", "editor", "viewer"]),
});

const acceptInvitationSchema = z.object({
	name: z.string().min(1),
	password: z.string().min(8),
});

/** 72 hours in milliseconds */
const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Generates a cryptographically-random 32-byte hex token suitable for use as
 * an invitation token.
 */
function generateToken(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
		"hex",
	);
}

/**
 * Validates that an invitation token exists, has not been accepted, and has not
 * expired. Returns the invitation row on success, or a Response on failure so
 * callers can return it directly.
 */
async function validateToken(
	token: string,
): Promise<typeof invitations.$inferSelect | Response> {
	const [invitation] = await db
		.select()
		.from(invitations)
		.where(eq(invitations.token, token))
		.limit(1);

	// Collapse all invalid states into a single 404 — avoids leaking whether a
	// token exists, was already used, or has expired.
	if (
		!invitation ||
		invitation.acceptedAt ||
		invitation.expiresAt < new Date()
	) {
		return new Response(JSON.stringify({ error: "Invitation not valid" }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	}

	return invitation;
}

export function createInvitationsRouter() {
	const router = new Hono();

	/**
	 * POST /invitations — admin-only
	 * Creates an invitation and sends an email via Resend.
	 */
	router.post("/invitations", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;
		if (!isAdmin(authUser)) return c.json({ error: "Forbidden" }, 403);

		const body = await c.req.json();
		const parsed = createInvitationSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: parsed.error.flatten() }, 400);
		}

		const { email, role } = parsed.data;
		const id = crypto.randomUUID();
		const token = generateToken();
		const now = new Date();
		const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

		await db.insert(invitations).values({
			id,
			email,
			role,
			token,
			invitedBy: authUser.id,
			expiresAt,
			createdAt: now,
		});

		// Send the invitation email if Resend is configured; skip silently in dev.
		const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5173";
		const inviteLink = `${clientUrl}/accept-invite?token=${token}`;
		const resend = getResendClient();

		if (!resend) {
			console.warn(
				"RESEND_API_KEY is not set — skipping invitation email for",
				email,
			);
		} else {
			const { error: emailError } = await resend.emails.send({
				from: process.env.EMAIL_FROM ?? "Bonfire <noreply@example.com>",
				to: email,
				subject: "You've been invited to Bonfire",
				text: `You've been invited to join Bonfire as ${role}.\n\nAccept your invitation here:\n${inviteLink}\n\nThis link expires in 72 hours.`,
			});

			if (emailError) {
				console.error("Failed to send invitation email:", emailError);
			}
		}

		return c.json({ id, email, role, expiresAt }, 201);
	});

	/**
	 * GET /invitations/:token — public
	 * Returns the email and role associated with a valid token.
	 */
	router.get("/invitations/:token", async (c) => {
		const token = c.req.param("token");
		const result = await validateToken(token);

		// validateToken returns a raw Response on failure
		if (result instanceof Response) return result;

		return c.json({ email: result.email, role: result.role });
	});

	/**
	 * POST /invitations/:token/accept — public
	 * Atomically claims the invitation and creates the user account.
	 *
	 * Strategy:
	 * 1. Inside a Drizzle transaction: conditional UPDATE to claim the invitation
	 *    row (concurrent second request gets zero rows → 410).
	 * 2. Call auth.api.signUpEmail (public signup path) to create the user.
	 *    NOTE: Better Auth runs signUpEmail on its own connection from the pool —
	 *    it does NOT participate in the Drizzle tx. If the tx later rolls back the
	 *    invitation claim, the user row will already exist. This is acceptable
	 *    because (a) the failure modes after signUpEmail are narrow, and (b)
	 *    signUpEmail is idempotent on duplicate email (returns an error we can
	 *    surface). We prefer signUpEmail over createUser because createUser is an
	 *    admin-plugin endpoint that may be tightened in future Better Auth releases.
	 * 3. Inside the same tx: patch the user's role to match the invitation role.
	 *    This patch is transactional, so a failure here rolls back the claim —
	 *    leaving the user without a role patch but the invitation unclaimed,
	 *    which is recoverable (re-accept will fail at signUpEmail with duplicate
	 *    email; admin can reset).
	 */
	router.post("/invitations/:token/accept", async (c) => {
		const token = c.req.param("token");

		const body = await c.req.json();
		const parsed = acceptInvitationSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: parsed.error.flatten() }, 400);
		}

		const { name, password } = parsed.data;

		try {
			const claimed = await db.transaction(async (tx) => {
				// Step 1: Atomically mark the invitation as accepted only if it is
				// still valid — not yet accepted and not expired.
				const now = new Date();
				const rows = await tx
					.update(invitations)
					.set({ acceptedAt: now })
					.where(
						and(
							eq(invitations.token, token),
							isNull(invitations.acceptedAt),
							gt(invitations.expiresAt, now),
						),
					)
					.returning();

				if (rows.length === 0) {
					// Invitation not found, already accepted, or expired.
					return null;
				}

				const invitation = rows[0];

				// Step 2: Create the user via the public signup path.
				// Runs outside this tx (Better Auth manages its own connection).
				const signUpResult = await auth.api.signUpEmail({
					body: { name, email: invitation.email, password },
				});

				if (!signUpResult?.user?.id) {
					throw new Error("signUpEmail did not return a user — rolling back");
				}

				// Step 3: Apply the invitation role inside the tx so the patch is
				// atomic with the invitation claim.
				await tx
					.update(user)
					.set({ role: invitation.role, updatedAt: new Date() })
					.where(eq(user.id, signUpResult.user.id));

				return invitation;
			});

			if (!claimed) {
				return c.json({ error: "Invitation is no longer valid" }, 410);
			}

			return c.json({ success: true });
		} catch (error) {
			console.error("Failed to accept invitation:", error);
			return c.json({ error: "Internal server error" }, 500);
		}
	});

	return router;
}
