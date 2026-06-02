import { json } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { requireAuth } from '$lib/server/modules/auth/guards';
import type { RequestHandler } from './$types';

/** Return the current user's profile and session info. */
export const GET: RequestHandler = async ({ request, locals }) => {
	requireAuth(locals);

	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	return json({ user: session.user, session: session.session });
};
