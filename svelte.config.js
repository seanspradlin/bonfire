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
		// svelteKitHandler cannot intercept OAuth token requests in time. We add
		// ORIGIN as a trusted origin so the check passes without opening it to
		// arbitrary third-party sites.
		csrf: {
			trustedOrigins: [process.env.ORIGIN].filter(Boolean)
		},

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
