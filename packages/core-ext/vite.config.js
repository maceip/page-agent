// @ts-check
import { dirname, resolve } from 'path'
import dts from 'unplugin-dts/vite'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	clearScreen: false,
	plugins: [dts({ tsconfigPath: './tsconfig.dts.json', bundleTypes: true })],
	publicDir: false,
	esbuild: {
		keepNames: true,
	},
	build: {
		lib: {
			entry: resolve(__dirname, 'src/index.ts'),
			name: 'PageAgentCoreExt',
			fileName: 'core-ext',
			formats: ['es'],
		},
		outDir: resolve(__dirname, 'dist', 'esm'),
		rollupOptions: {
			external: [
				'dompurify',
				// all the internal packages
				/^@page-agent\//,
			],
		},
		minify: false,
		sourcemap: true,
	},
	define: {
		'process.env.NODE_ENV': '"production"',
	},
})
