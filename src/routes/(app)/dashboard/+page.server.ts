import type { ApiUser, User } from '$lib/types/user';
import { formatJoinedDate, formatRelativeTime } from '$lib/utils/dateFormat';
import type { PageServerLoad } from './$types';

function toRoleLabel(role: string): string {
	return role ? role[0].toUpperCase() + role.slice(1).toLowerCase() : 'Viewer';
}
export const load: PageServerLoad = async ({ fetch, parent }) => {
	// Ensure user is authenticated
	await parent();

	try {
		const response = await fetch('/api/users');

		if (!response.ok) {
			if (response.status === 403) {
				throw new Error('You do not have permission to view user management');
			}
			throw new Error('Failed to fetch users');
		}

		const result = await response.json();
		const apiUsers: ApiUser[] = result.users || [];

		// Transform API users to frontend display format
		const users: User[] = apiUsers.map((user: ApiUser) => ({
			id: user.id,
			name: user.name,
			email: user.email,
			role: toRoleLabel(user.role),
			status: user.banned ? 'Inactive' : 'Active',
			joined: formatJoinedDate(user.createdAt),
			lastSeen: formatRelativeTime(user.updatedAt),
			banned: user.banned,
			emailVerified: user.emailVerified
		}));

		return {
			users
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to fetch users';
		console.error('Dashboard load error:', message);
		throw error;
	}
};
