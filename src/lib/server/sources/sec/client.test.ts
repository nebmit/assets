import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { archiveEvidence, readSourceText, readZipEntries, SecAccessError } from './client.js';
import { pruneRawArchive } from '../../rawArchive.js';

describe('SEC transport and evidence boundaries', () => {
	it('rejects successful HTML challenges and oversized responses', async () => {
		await expect(readSourceText(new Response('<html>Access Denied</html>'),'https://www.sec.gov/test',1024)).rejects.toBeInstanceOf(SecAccessError);
		await expect(readSourceText(new Response('123456'),'https://www.sec.gov/test',3)).rejects.toThrow('size limit');
	});
	it('propagates interrupted bodies without accepting partial content', async () => {
		const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"partial":')); controller.error(new Error('connection interrupted')); } });
		await expect(readSourceText(new Response(body),'https://www.sec.gov/test',1024)).rejects.toThrow('interrupted');
	});
	it('streams selected ZIP entries and rejects invalid archives', async () => {
		const entries: string[] = [];
		await readZipEntries('tests/fixtures/sec/bulk-sample.zip',(name)=>name.includes('789019'),async (name,text)=>{ entries.push(name); expect(JSON.parse(text).cik).toBe(789019); });
		expect(entries).toEqual(['CIK0000789019.json']);
		await expect(readZipEntries('tests/fixtures/sec/msft-form4.txt',()=>true,async()=>{})).rejects.toThrow();
		await expect(readZipEntries('tests/fixtures/sec/bulk-sample.zip',()=>true,async()=>{throw new Error('parser failure');})).rejects.toThrow('parser failure');
	});
	it('preserves immutable evidence across retries and raw retention, detecting corruption', async () => {
		const root = await mkdtemp(path.join(tmpdir(),'sec-evidence-test-'));
		try {
			const first = await archiveEvidence('https://www.sec.gov/sample','original',root);
			const repeat = await archiveEvidence('https://www.sec.gov/sample','original',root);
			const corrected = await archiveEvidence('https://www.sec.gov/sample','corrected',root);
			expect(first.path).toBe(repeat.path); expect(corrected.path).not.toBe(first.path);
			await pruneRawArchive('2030-01-01',1,root);
			expect(await readFile(first.path,'utf8')).toBe('original');
			await writeFile(first.path,'corrupt');
			await expect(archiveEvidence('https://www.sec.gov/sample','original',root)).rejects.toThrow('corrupt');
		} finally { await rm(root,{recursive:true,force:true}); }
	});
});
