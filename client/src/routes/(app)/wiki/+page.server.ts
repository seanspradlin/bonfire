import type { WikiPage } from '$lib/types/wiki';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	const [listResponse, indexResponse] = await Promise.all([
		fetch('/api/wiki-pages'),
		fetch('/api/wiki-pages/index')
	]);

	if (!listResponse.ok) throw new Error('Failed to fetch wiki pages');

	const result = await listResponse.json();
	const index: WikiPage | null = indexResponse.ok
		? ((await indexResponse.json()).wikiPage ?? null)
		: null;

	return { pages: result.wikiPages as WikiPage[], index };
};
