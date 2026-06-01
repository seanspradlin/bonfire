import type { HandleFetch } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

/**
 * Server-side `+page.server.ts` / `+layout.server.ts` loads call
 * `fetch('/api/...')`. During local `bun run dev` these are handled by the Vite
 * dev proxy, but in the Docker stack the SvelteKit server runs in its own
 * container with no proxy in front of it. When `INTERNAL_API_URL` is set we
 * rewrite those SSR calls to hit the backend container directly (stripping the
 * `/api` prefix, just like the Vite proxy and Caddy do), forwarding cookies so
 * the session is preserved.
 *
 * When `INTERNAL_API_URL` is unset (host dev) the request is passed through
 * untouched and the Vite proxy continues to handle it.
 */
export const handleFetch: HandleFetch = async ({ event, request, fetch }) => {
	const internalApi = env.INTERNAL_API_URL;
	if (internalApi) {
		const url = new URL(request.url);
		if (url.pathname.startsWith('/api/')) {
			const target =
				internalApi.replace(/\/$/, '') + url.pathname.replace(/^\/api/, '') + url.search;
			const headers = new Headers(request.headers);
			const cookie = event.request.headers.get('cookie');
			if (cookie) headers.set('cookie', cookie);
			request = new Request(target, {
				method: request.method,
				headers,
				body: request.body,
				redirect: 'manual',
				// `duplex` is required when streaming a request body.
				...(request.body ? { duplex: 'half' } : {})
			} as RequestInit);
		}
	}
	return fetch(request);
};
