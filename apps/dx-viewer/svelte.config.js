import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Poll /_app/version.json so an already-open tab notices a new deploy.
		// Without this, a running SPA keeps executing the build it first loaded
		// until a hard refresh. The root layout watches `updated` and prompts.
		version: { pollInterval: 60_000 },
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: false
		}),
		alias: {
			$components: './src/components'
		}
	}
};

export default config;
