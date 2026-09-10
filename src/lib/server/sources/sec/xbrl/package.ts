import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../../config.js';
import { XMLParser } from 'fast-xml-parser';
import { archiveEvidence, fetchSecText, hash, type Evidence } from '../client.js';
import { XbrlError, type FilingPackage } from './types.js';

/** SGML envelopes only: XBRL interpretation belongs exclusively to Arelle. */
export async function submissionDocuments(file: string): Promise<{ name: string; type: string; body: string }[]> {
	const result: { name: string; type: string; body: string }[] = [];
	let name = '', type = '', body = '', inDocument = false, inText = false, keep = false;
	for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
		if (line === '<DOCUMENT>') { inDocument = true; name = ''; type = ''; body = ''; continue; }
		if (!inDocument) continue;
		if (line.startsWith('<TYPE>')) type = line.slice(6).trim();
		if (line.startsWith('<FILENAME>')) name = line.slice(10).trim();
		if (line === '<TEXT>') { inText = true; keep = /\.(?:xhtml|html|htm|xml|xsd)$/i.test(name); continue; }
		if (line === '<XBRL>' || line === '</XBRL>') continue;
		if (line === '</TEXT>') { inText = false; continue; }
		if (line === '</DOCUMENT>') { if (keep && name) result.push({ name, type, body: body.trimStart() }); inDocument = false; keep = false; continue; }
		if (inText && keep) { body += line + '\n'; if (Buffer.byteLength(body) > 64 * 1024 ** 2) throw new XbrlError('document_size_limit', name); }
	}
	if (inDocument) throw new XbrlError('unreadable_document', 'Incomplete SGML document');
	return result;
}

/** Only XML dependency attributes are inspected here; values never become financial facts. */
export function dependencyUrls(body: string, base: string): string[] {
	const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', processEntities: false });
	const urls = new Set<string>();
	function walk(value: unknown): void {
		if (!value || typeof value !== 'object') return;
		for (const [key, child] of Object.entries(value)) {
			if (typeof child === 'string' && /^@(?:[\w-]+:)?(?:schemaLocation|href)$/.test(key)) {
				for (const part of child.split(/\s+/)) {
					const url = new URL(part, base); url.hash = '';
					if (/\.(?:xsd|xml)$/i.test(url.pathname) && url.href !== base) urls.add(url.href);
				}
			} else walk(child);
		}
	}
	walk(parser.parse(body)); return [...urls].sort();
}

export async function buildPackage(input: { accession: string; acceptedAt: string | null; form: string; evidence: Evidence; root?: string; offline?: boolean }): Promise<FilingPackage> {
	const documents = await submissionDocuments(input.evidence.path);
	const base = new URL(`https://www.sec.gov/Archives/edgar/data/${Number(input.accession.slice(0, 10))}/${input.accession.replaceAll('-', '')}/`);
	// The archive CIK can differ from the accession prefix. The source URL is authoritative.
	const archive = new URL('.', input.evidence.url.startsWith('https://') ? input.evidence.url : base);
	const byUrl = new Map<string, Evidence>();
	const bodies = new Map<string, string>();
	for (const document of documents) {
		if (document.name.includes('/') || document.name.includes('\\') || document.name === '..') throw new XbrlError('invalid_document_name', document.name);
		const url = new URL(document.name, archive).href;
		const evidence = await archiveEvidence(url, document.body, input.root);
		byUrl.set(url, { ...evidence, observedAt: input.evidence.observedAt }); bodies.set(url, document.body);
	}
	const inline = documents.filter((d) => /xmlns:[\w-]+=["']http:\/\/www.xbrl.org\/(?:2008|2013)\/inlineXBRL["']/.test(d.body)).map((d) => new URL(d.name, archive).href);
	const instances = documents.filter((d) => /<(?:\w+:)?xbrl\b/.test(d.body)).map((d) => new URL(d.name, archive).href);
	const entrypoints = inline.length ? inline : instances.filter((u) => !u.endsWith('_htm.xml')).slice(0, 1);
	if (!entrypoints.length) throw new XbrlError('missing_entrypoint', 'No XBRL entrypoint in archived filing');
	const queue = [...entrypoints], visited = new Set<string>();
	while (queue.length) {
		const url = queue.shift()!; if (visited.has(url)) continue; visited.add(url);
		if (visited.size > 2000) throw new XbrlError('dependency_limit', 'More than 2000 taxonomy documents');
		if (!bodies.has(url)) {
			const cache = path.join(input.root ?? config().RAW_DATA_DIR, 'sec', 'taxonomy-catalog');
			const index = path.join(cache, hash(url));
			let evidence: Evidence | undefined;
			try { evidence = JSON.parse(await readFile(index, 'utf8')) as Evidence; }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
			if (!evidence) {
				if (input.offline) throw new XbrlError('missing_dependency', url);
				const body = await fetchSecText(url.replace(/^http:/, 'https:'));
				evidence = await archiveEvidence(url, body, input.root);
				await mkdir(cache, { recursive: true }); const temporary = index + '.' + randomUUID(); await writeFile(temporary, JSON.stringify(evidence)); await rename(temporary, index);
			}
			const body = await readFile(evidence.path, 'utf8');
			if (hash(body) !== evidence.hash) throw new XbrlError('evidence_integrity', url);
			bodies.set(url, body); byUrl.set(url, evidence);
		}
		queue.push(...dependencyUrls(bodies.get(url)!, url));
	}
	return { schemaVersion: 1, accession: input.accession, acceptedAt: input.acceptedAt, submissionHash: input.evidence.hash, entrypoints: entrypoints.sort(), documents: [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url)) };
}
export async function verifyPackage(manifest: FilingPackage): Promise<void> {
	for (const document of manifest.documents) if (hash(await readFile(document.path)) !== document.hash) throw new XbrlError('evidence_integrity', `Hash mismatch: ${document.url}`);
}
