import path from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// The svelte plugin compiles rune-using modules (*.svelte.ts) for tests.
	plugins: [svelte()],
	resolve: {
		alias: { $lib: path.resolve(import.meta.dirname, 'src/lib') }
	},
	test: {
		include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
		// The integration files under tests/ reset the TEST_DATABASE_URL
		// database and would clobber each other in parallel; DB-free unit
		// runs keep full parallelism.
		fileParallelism: process.env.TEST_DATABASE_URL === undefined
	}
});
