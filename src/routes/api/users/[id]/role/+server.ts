import { json } from '@sveltejs/kit';
import { and, eq, ne, sql } from 'drizzle-orm';
import { isAdmin, requireAuth } from '$lib/server/modules/auth/guards';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/** Thrown when a role-change would remove the last admin in the system. */
class LastAdminError extends Error {
	constructor() {
		super('Cannot remove last admin');
	}
}

const VALID_ROLES = ['admin', 'editor', 'viewer'];

/** Update a user's role (admin only). */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const authUser = requireAuth(locals);
	if (!isAdmin(authUser)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const userId = params.id;
	let body: { role: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (!body.role) {
		return json({ error: 'Role is required' }, { status: 400 });
	}

	if (!VALID_ROLES.includes(body.role)) {
		return json(
			{ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` },
			{ status: 400 }
		);
	}

	// Prevent an admin from accidentally locking themselves out.
	if (userId === authUser.id && body.role !== 'admin') {
		return json({ error: 'Cannot demote yourself' }, { status: 400 });
	}

	try {
		/**
		 * Serializable isolation prevents the TOCTOU race where two concurrent
		 * admin-demotion requests both pass the count check and both proceed.
		 */
		const updated = await db.transaction(
			async (tx) => {
				const [targetUser] = await tx
					.select({ role: user.role })
					.from(user)
					.where(eq(user.id, userId))
					.limit(1);

				if (!targetUser) {
					throw Object.assign(new Error('User not found'), { code: 'USER_NOT_FOUND' });
				}

				if (body.role !== 'admin') {
					const [{ adminCount }] = await tx
						.select({ adminCount: sql<number>`count(*)::int` })
						.from(user)
						.where(and(eq(user.role, 'admin'), ne(user.id, userId)));

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
			{ isolationLevel: 'serializable' }
		);

		return json(updated);
	} catch (err) {
		if (err instanceof LastAdminError) {
			return json({ error: 'Cannot remove last admin' }, { status: 400 });
		}
		if (err instanceof Error && (err as Error & { code?: string }).code === 'USER_NOT_FOUND') {
			return json({ error: 'User not found' }, { status: 404 });
		}
		console.error('Failed to update user role:', err);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
