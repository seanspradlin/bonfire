import { error } from '@sveltejs/kit';
import type { WikiPage } from '$lib/types/wiki';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, params }) => {
	const response = await fetch(`/api/wiki-pages/${params.slug}`);
	if (response.status === 404) throw error(404, 'Wiki page not found');
	if (!response.ok) throw new Error('Failed to fetch wiki page');

	const result = await response.json();
	return {
		page: result.wikiPage as WikiPage,
		sourceDocuments: result.sourceDocuments as { id: string; title: string }[]
	};
};
