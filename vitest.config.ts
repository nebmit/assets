import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: { $lib: path.resolve(import.meta.dirname, 'src/lib') }
	},
	test: {
		include: ['src/**/*.test.ts', 'tests/**/*.test.ts']
	}
});
