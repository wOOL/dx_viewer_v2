import { paraglide } from '@inlang/paraglide-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		paraglide({
			project: '../../packages/i18n/project.inlang',
			outdir: './src/lib/paraglide'
		}),
		svelte()
	],
	publicDir: 'static',
	build: {
		target: 'chrome108',
		outDir: 'dist',
		emptyOutDir: true,
		rollupOptions: {
			input: {
				popup: resolve(__dirname, 'popup/index.html'),
				background: resolve(__dirname, 'src/background/index.ts'),
				content: resolve(__dirname, 'src/content/index.ts')
			},
			output: {
				entryFileNames: '[name]/index.js',
				chunkFileNames: 'shared/[name]-[hash].js',
				assetFileNames: '[name]/[name].[ext]'
			}
		}
	},
	resolve: {
		alias: {
			'@adapters': resolve(__dirname, 'src/adapters'),
			'@be-certain/ui': resolve(__dirname, '../../packages/ui')
		}
	}
});
