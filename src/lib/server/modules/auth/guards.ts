import { error } from '@sveltejs/kit';
import type { AuthUser } from '@/auth';

/**
 * Assert that the request is authenticated. Throws a 401 HTTP error if not.
 * Returns the user so callers can use it without null-checks.
 */
export function requireAuth(locals: { user?: AuthUser }): AuthUser {
	if (!locals.user) {
		error(401, { message: 'Unauthorized' });
	}
	return locals.user;
}

/**
 * Check whether a user has the admin role.
 * Handles both string and array role shapes from Better Auth.
 */
export function isAdmin(user: { role?: string | string[] | null }): boolean {
	if (Array.isArray(user.role)) {
		return user.role.includes('admin');
	}
	if (typeof user.role === 'string') {
		return user.role
			.split(',')
			.map((r) => r.trim())
			.includes('admin');
	}
	return false;
}

/**
 * Check whether a user can edit content (admin or editor role).
 */
export function canEdit(user: { role?: string | string[] | null }): boolean {
	const roles = Array.isArray(user.role)
		? user.role
		: typeof user.role === 'string'
			? user.role.split(',').map((r) => r.trim())
			: [];
	return roles.some((r) => r === 'admin' || r === 'editor');
}

/**
 * Whether a user may modify (update or delete) a resource owned by `ownerId`.
 *
 * Authorization model:
 *   - Admins may modify any resource.
 *   - Editors may modify only resources they own.
 *   - Everyone else (viewers / default `user` role) may not modify anything.
 *
 * A null `ownerId` (legacy/ownerless resource) is treated as not-owned, so only
 * admins may modify it.
 */
export function canModifyResource(
	user: { id: string; role?: string | string[] | null },
	ownerId: string | null
): boolean {
	if (isAdmin(user)) return true;
	if (!canEdit(user)) return false;
	return ownerId !== null && ownerId === user.id;
}
