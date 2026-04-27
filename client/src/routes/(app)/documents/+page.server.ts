import { redirect } from '@sveltejs/kit';
import type { Document } from '$lib/types/document';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { user } = await parent();

	if (!['admin', 'editor'].includes(user?.role ?? '')) {
		throw redirect(302, '/chat');
	}

	const response = await fetch('/api/documents');
	if (!response.ok) throw new Error('Failed to fetch documents');

	const result = await response.json();
	return { documents: result.documents as Document[] };
};
