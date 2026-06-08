import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter(),

		// SvelteKit's CSRF check fires before handle hooks, so Better Auth's
		// svelteKitHandler cannot intercept OAuth token requests in time. trustedOrigins: ['*']
		// sets csrf_check_origin=false at build time (see SvelteKit write_server.js), which
		// skips the check entirely. Safe because Better Auth sets SameSite=Lax on all session
		// cookies — browsers won't send credentials on cross-origin POSTs from malicious sites.
		csrf: { trustedOrigins: ['*'] },

		// '@' maps to src/lib/server so that ported server modules keep their
		// @/modules/... imports working unchanged.
		alias: {
			'@': './src/lib/server'
		},

		typescript: {
			config: (config) => ({
				...config,
				include: [...config.include, '../drizzle.config.ts']
			})
		}
	}
};

export default config;
