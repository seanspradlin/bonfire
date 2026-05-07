import { error } from '@sveltejs/kit';
import type { Document } from '$lib/types/document';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, params }) => {
	const response = await fetch(`/api/documents/${params.id}`);
	if (response.status === 404) throw error(404, 'Document not found');
	if (response.status === 403) throw error(403, 'Forbidden');
	if (!response.ok) throw new Error('Failed to fetch document');

	const result = await response.json();
	return { document: result.document as Document };
};
