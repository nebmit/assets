import { createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';

/** Compression is a storage detail: logical paths and content hashes never change. */
export async function writeStored(file: string, content: string | AsyncIterable<Uint8Array>, flags = 'wx'): Promise<void> {
	await pipeline(typeof content === 'string' ? Readable.from([content]) : Readable.from(content), createGzip({ level: 9 }), createWriteStream(file, { flags }));
	const handle = await open(file, 'r+');
	try { await handle.sync(); } finally { await handle.close(); }
}

/** Detect gzip by magic, not filename, so existing plain evidence remains readable. */
export async function openStored(file: string): Promise<Readable> {
	const handle = await open(file, 'r');
	try {
		const magic = Buffer.alloc(2);
		const { bytesRead } = await handle.read(magic, 0, 2, 0);
		const source = handle.createReadStream({ start: 0 });
		return bytesRead === 2 && magic[0] === 0x1f && magic[1] === 0x8b
			? source.compose(createGunzip()) : source;
	} catch (error) { await handle.close(); throw error; }
}

export async function readStored(file: string): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of await openStored(file)) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

export async function readStoredText(file: string): Promise<string> {
	return (await readStored(file)).toString('utf8');
}

/** Materialize plain bytes for tools that do not understand our storage encoding. */
export async function copyStored(source: string, target: string): Promise<void> {
	await pipeline(await openStored(source), createWriteStream(target));
}
