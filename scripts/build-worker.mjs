import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

await build({
	entryPoints: [path.join(root, 'src/worker/main.ts')],
	outfile: path.join(root, 'build/worker.js'),
	bundle: true,
	platform: 'node',
	target: 'node22',
	format: 'esm',
	sourcemap: true,
	// postgres uses dynamic requires; keep node deps external and ship node_modules
	packages: 'external',
	alias: { $lib: path.join(root, 'src/lib') },
	banner: {
		js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
	}
});

console.log('worker bundled to build/worker.js');
