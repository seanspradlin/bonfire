import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import type { ApiUser } from '$lib/types/user';

interface SessionResponse {
	user?: ApiUser;
}

export const load: LayoutServerLoad = async ({ fetch, url }) => {
	// Use event.fetch so the session cookie is forwarded automatically.
	// The auth client is configured at basePath '/api/auth', so the
	// get-session endpoint is /api/auth/get-session.
	let session: SessionResponse | null = null;

	try {
		const res = await fetch('/api/auth/get-session');
		if (!res.ok) {
			throw redirect(302, '/login?err=auth_unavailable');
		}
		session = (await res.json().catch(() => null)) as SessionResponse | null;
	} catch (err) {
		// Re-throw SvelteKit redirects — they are not real errors.
		if (err instanceof Response || (err as { status?: number })?.status === 302) throw err;
		// Network failure or JSON parse error → send to login with context.
		throw redirect(302, '/login?err=auth_unavailable');
	}

	if (!session?.user) {
		throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname)}`);
	}

	return { user: session.user };
};
