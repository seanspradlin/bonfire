import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/modules/auth/guards';
import { repo, wikiRepo } from '$lib/server/deps';
import type { RequestHandler } from './$types';

/** Retrieve a single wiki page with its source document titles. */
export const GET: RequestHandler = async ({ params, locals }) => {
	requireAuth(locals);

	const page = await wikiRepo.getBySlug(params.slug);
	if (!page) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const titleMap = await repo.getTitlesByIds(page.sourceDocumentIds);
	const sourceDocuments = page.sourceDocumentIds
		.filter((id) => id in titleMap)
		.map((id) => ({ id, title: titleMap[id] }));

	return json({ wikiPage: page, sourceDocuments });
};
