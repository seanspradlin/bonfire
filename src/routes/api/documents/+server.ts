import { json } from '@sveltejs/kit';
import { canEdit, isAdmin, requireAuth } from '$lib/server/modules/auth/guards';
import { repo, embedder } from '$lib/server/deps';
import type { RequestHandler } from './$types';

/** List all documents visible to the authenticated user. */
export const GET: RequestHandler = async ({ locals }) => {
	const authUser = requireAuth(locals);
	if (!canEdit(authUser)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const docs = await repo.list(isAdmin(authUser) ? undefined : { userId: authUser.id });

	docs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

	return json({ documents: docs });
};

// Suppress unused-import warning — embedder is re-exported for route-level use.
void embedder;
