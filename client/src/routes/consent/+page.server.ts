import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, url }) => {
	const res = await fetch('/api/auth/get-session');
	const session = res.ok ? await res.json().catch(() => null) : null;

	if (!session?.user) {
		throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
	}
};
