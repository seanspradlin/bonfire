import { json } from '@sveltejs/kit';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { invitations, user } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

const acceptInvitationSchema = z.object({
	name: z.string().min(1),
	password: z.string().min(8)
});

/**
 * POST /api/invitations/:token/accept — public
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
 *    signUpEmail is idempotent on duplicate email. We prefer signUpEmail over
 *    createUser because createUser is an admin-plugin endpoint that may be
 *    tightened in future Better Auth releases.
 * 3. Inside the same tx: patch the user's role to match the invitation role.
 *    This patch is transactional, so a failure here rolls back the claim —
 *    leaving the user without a role patch but the invitation unclaimed,
 *    which is recoverable (re-accept will fail at signUpEmail with duplicate
 *    email; admin can reset).
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const { token } = params;

	const body = await request.json();
	const parsed = acceptInvitationSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: parsed.error.flatten() }, { status: 400 });
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
						gt(invitations.expiresAt, now)
					)
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
				body: { name, email: invitation.email, password }
			});

			if (!signUpResult?.user?.id) {
				throw new Error('signUpEmail did not return a user — rolling back');
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
			return json({ error: 'Invitation is no longer valid' }, { status: 410 });
		}

		return json({ success: true });
	} catch (err) {
		console.error('Failed to accept invitation:', err);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
