import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		proxy: {
			'/auth': {
				target: 'http://localhost:3000',
				changeOrigin: false
			},
			'/api': {
				target: 'http://localhost:3000',
				changeOrigin: false,
				rewrite: (path) => path.replace(/^\/api/, '')
			},
			'/mcp': {
				target: 'http://localhost:3000',
				changeOrigin: false
			},
			'/.well-known': {
				target: 'http://localhost:3000',
				changeOrigin: false
			}
		}
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
