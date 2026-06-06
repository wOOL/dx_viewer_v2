import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
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
					setupFiles: ['./src/vitest-setup-client.ts'],
					// Workspace packages' runes/browser tests run here too (the packages
					// are source-form; this app's vite pipeline compiles them anyway).
					include: [
						'src/**/*.svelte.{test,spec}.{js,ts}',
						'../../packages/*/src/**/*.svelte.{test,spec}.{js,ts}'
					],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: [
						'src/**/*.{test,spec}.{js,ts}',
						'../../packages/*/src/**/*.{test,spec}.{js,ts}'
					],
					exclude: [
						'src/**/*.svelte.{test,spec}.{js,ts}',
						'../../packages/*/src/**/*.svelte.{test,spec}.{js,ts}'
					]
				}
			}
		]
	}
});
