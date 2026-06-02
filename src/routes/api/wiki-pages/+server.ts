import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/modules/auth/guards';
import { wikiRepo } from '$lib/server/deps';
import type { RequestHandler } from './$types';

/** List all wiki pages, sorted newest-first. */
export const GET: RequestHandler = async ({ locals }) => {
	requireAuth(locals);

	const pages = await wikiRepo.list();
	pages.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

	return json({ wikiPages: pages });
};
