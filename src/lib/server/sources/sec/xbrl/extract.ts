import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { artifactSchema, PARSER_CONFIG, XbrlError, type FilingPackage, type XbrlArtifact } from './types.js';
import { verifyPackage } from './package.js';
let queue: Promise<unknown> = Promise.resolve();
/** Serialize invocations even when several issuers are requested concurrently. */
export function extractPackage(manifest: FilingPackage): Promise<XbrlArtifact> {
	const pending = queue.then(() => extract(manifest)); queue = pending.catch(() => {}); return pending;
}
async function extract(manifest: FilingPackage): Promise<XbrlArtifact> {
	await verifyPackage(manifest);
	const directory = await mkdtemp(path.join(tmpdir(), 'assets-xbrl-'));
	try {
		const urls: Record<string, string> = {};
		for (const document of manifest.documents) { urls[document.url] = document.hash; await copyFile(document.path, path.join(directory, document.hash)); }
		const request = path.join(directory, 'request.json'), output = path.join(directory, 'output.json');
		await writeFile(request, JSON.stringify({ root: directory, urls, entrypoints: manifest.entrypoints }));
		await new Promise<void>((resolve, reject) => {
			const child = spawn(process.env.XBRL_PYTHON ?? '.venv-xbrl/bin/python', ['scripts/xbrl/extract.py', request, output], { stdio: ['ignore', 'ignore', 'pipe'] });
			let stderr = '', timedOut = false;
			child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-16000); });
			const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, PARSER_CONFIG.timeoutMs);
			child.on('error', (error) => { clearTimeout(timeout); reject(new XbrlError('parser_unavailable', error.message)); });
			child.on('close', (code, signal) => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new XbrlError(timedOut ? 'parser_timeout' : code === 72 ? 'memory_limit' : signal ? 'parser_terminated' : 'extraction_failed', stderr || String(signal))); });
		});
		const parsed = artifactSchema.safeParse(JSON.parse(await readFile(output, 'utf8')));
		if (!parsed.success) throw new XbrlError('artifact_version', parsed.error.message);
		return parsed.data;
	} finally { await rm(directory, { recursive: true, force: true }); }
}
