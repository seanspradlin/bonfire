import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { invitations } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/**
 * GET /api/invitations/:token — public
 * Returns the email and role associated with a valid token.
 */
export const GET: RequestHandler = async ({ params }) => {
	const { token } = params;

	const [invitation] = await db
		.select()
		.from(invitations)
		.where(eq(invitations.token, token))
		.limit(1);

	// Collapse all invalid states into a single 404 — avoids leaking whether a
	// token exists, was already used, or has expired.
	if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
		return json({ error: 'Invitation not valid' }, { status: 404 });
	}

	return json({ email: invitation.email, role: invitation.role });
};
