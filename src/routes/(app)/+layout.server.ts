import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// The auth hook in hooks.server.ts populates event.locals.user from the
// session cookie on every request, so we can read it directly here instead
// of doing a self-fetch to /api/auth/get-session.
export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname)}`);
	}

	return {
		user: {
			id: locals.user.id,
			name: locals.user.name,
			email: locals.user.email,
			role: locals.user.role ?? 'viewer'
		}
	};
};
