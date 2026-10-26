import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeStored } from '../../../storage.js';
import { submissionDocuments } from './package.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'package-test-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function envelope(documents: { type: string; name: string; text: string }[]): string {
	return documents.map((d) => `<DOCUMENT>\n<TYPE>${d.type}\n<FILENAME>${d.name}\n<TEXT>\n${d.text}</TEXT>\n</DOCUMENT>\n`).join('');
}

async function stored(text: string): Promise<string> {
	const file = path.join(root, 'submission');
	await writeStored(file, text);
	return file;
}

describe('submissionDocuments', () => {
	it('keeps XML-family documents with their exact bodies and skips the rest', async () => {
		const file = await stored(envelope([
			{ type: '10-K', name: 'report.htm', text: '\n<html>\n  <body/>\n</html>\n' },
			{ type: 'GRAPHIC', name: 'logo.jpg', text: 'binary\n' },
			{ type: 'EX-101.SCH', name: 'report.xsd', text: '<XBRL>\n<schema/>\n</XBRL>\n' }
		]));
		expect(await submissionDocuments(file)).toEqual([
			{ name: 'report.htm', type: '10-K', body: '<html>\n  <body/>\n</html>\n' },
			{ name: 'report.xsd', type: 'EX-101.SCH', body: '<schema/>\n' }
		]);
	});

	it('fails loudly on an unterminated document', async () => {
		const file = await stored('<DOCUMENT>\n<TYPE>10-K\n<FILENAME>report.htm\n<TEXT>\n<html>\n');
		await expect(submissionDocuments(file)).rejects.toMatchObject({ code: 'unreadable_document' });
	});

	it('reads a large many-line document in linear time', async () => {
		const line = '<p>' + 'x'.repeat(400) + '</p>';
		const file = await stored(envelope([{ type: '10-K', name: 'big.htm', text: `${line}\n`.repeat(50_000) }]));
		const started = performance.now();
		const [document] = await submissionDocuments(file);
		expect(document.body.length).toBe((line.length + 1) * 50_000);
		// The previous per-line re-measure took tens of seconds at this size.
		expect(performance.now() - started).toBeLessThan(3_000);
	});
});
