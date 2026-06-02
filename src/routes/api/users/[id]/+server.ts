import { json } from '@sveltejs/kit';
import { and, eq, ne, sql } from 'drizzle-orm';
import { isAdmin, requireAuth } from '$lib/server/modules/auth/guards';
import { db } from '$lib/server/db';
import {
	account,
	oauthAccessToken,
	oauthConsent,
	oauthRefreshToken,
	session,
	user
} from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/** Thrown when a deletion would remove the last admin in the system. */
class LastAdminError extends Error {
	constructor() {
		super('Cannot delete the last admin');
	}
}

/** Delete a user and all their associated data (admin only). */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const authUser = requireAuth(locals);
	if (!isAdmin(authUser)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const userId = params.id;

	if (userId === authUser.id) {
		return json({ error: 'Cannot delete yourself' }, { status: 400 });
	}

	try {
		await db.transaction(
			async (tx) => {
				const [targetUser] = await tx
					.select({ id: user.id, role: user.role })
					.from(user)
					.where(eq(user.id, userId))
					.limit(1);

				if (!targetUser) {
					throw Object.assign(new Error('User not found'), { code: 'USER_NOT_FOUND' });
				}

				// Prevent removing the last admin.
				if (targetUser.role === 'admin') {
					const [{ adminCount }] = await tx
						.select({ adminCount: sql<number>`count(*)::int` })
						.from(user)
						.where(and(eq(user.role, 'admin'), ne(user.id, userId)));

					if (adminCount === 0) {
						throw new LastAdminError();
					}
				}

				await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, userId));
				await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, userId));
				await tx.delete(oauthConsent).where(eq(oauthConsent.userId, userId));
				await tx.delete(session).where(eq(session.userId, userId));
				await tx.delete(account).where(eq(account.userId, userId));
				await tx.delete(user).where(eq(user.id, userId));
			},
			{ isolationLevel: 'serializable' }
		);

		return new Response(null, { status: 204 });
	} catch (err) {
		if (err instanceof LastAdminError) {
			return json({ error: 'Cannot delete the last admin' }, { status: 400 });
		}
		if (err instanceof Error && (err as Error & { code?: string }).code === 'USER_NOT_FOUND') {
			return json({ error: 'User not found' }, { status: 404 });
		}
		console.error('Failed to delete user:', err);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
