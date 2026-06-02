import { error, json } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/** Change the authenticated user's password via Better Auth's changePassword API. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, { message: 'Unauthorized' });
	}

	let body: { currentPassword: string; newPassword: string };
	try {
		body = await request.json();
	} catch {
		error(400, { message: 'Invalid JSON body' });
	}

	const { currentPassword, newPassword } = body;
	if (!currentPassword || !newPassword) {
		error(400, { message: 'currentPassword and newPassword are required' });
	}
	if (newPassword.length < 8) {
		error(400, { message: 'New password must be at least 8 characters' });
	}

	try {
		await auth.api.changePassword({
			body: { currentPassword, newPassword, revokeOtherSessions: false },
			headers: request.headers
		});
		return json({ success: true });
	} catch (err) {
		console.error('Failed to change password:', err);
		error(500, { message: 'Internal server error' });
	}
};
