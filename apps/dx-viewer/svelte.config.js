import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter({ fallback: 'index.html' }),
		// Poll /_app/version.json so an already-open tab notices a new deploy.
		// Without this a running SPA keeps executing the build it first loaded
		// until a hard refresh. The root layout watches `updated` and prompts.
		version: { pollInterval: 60_000 }
	}
};

export default config;
