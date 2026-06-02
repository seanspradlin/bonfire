import { json } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { isAdmin, requireAuth } from '$lib/server/modules/auth/guards';
import type { RequestHandler } from './$types';

/** List all users (admin only). */
export const GET: RequestHandler = async ({ request, locals }) => {
	const authUser = requireAuth(locals);
	if (!isAdmin(authUser)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const result = await auth.api.listUsers({
		headers: request.headers,
		query: { limit: 100, offset: 0 }
	});

	return json(result);
};
