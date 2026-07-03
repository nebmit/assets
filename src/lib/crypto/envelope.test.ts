import { describe, expect, it } from 'vitest';
import {
	decryptJson,
	deriveKek,
	encryptJson,
	fromBase64url,
	generateDek,
	toBase64url,
	unwrapDek,
	wrapDek
} from './envelope';

function fakePrfOutput(seed: number): Uint8Array {
	return new Uint8Array(32).fill(seed);
}

describe('base64url', () => {
	it('round-trips arbitrary bytes without padding', () => {
		const bytes = new Uint8Array([0, 1, 250, 255, 62, 63]);
		const encoded = toBase64url(bytes);
		expect(encoded).not.toMatch(/[+/=]/);
		expect(fromBase64url(encoded)).toEqual(bytes);
	});
});

describe('envelope', () => {
	it('wraps and unwraps a DEK, and the DEK round-trips payloads', async () => {
		const kek = await deriveKek(fakePrfOutput(7), 'assets-test');
		const dek = await generateDek();
		const blob = await wrapDek(dek, kek);
		expect(blob).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

		const restored = await unwrapDek(blob, kek);
		const payload = { watchlist: ['DE0007164600', 'DE0008404005'], note: 'ümlaut ✓' };
		const encrypted = await encryptJson(restored, payload);
		expect(await decryptJson(dek, encrypted)).toEqual(payload);
	});

	it('derives the same KEK from the same PRF output, and different ones otherwise', async () => {
		const kekA = await deriveKek(fakePrfOutput(1), 'purpose');
		const kekB = await deriveKek(fakePrfOutput(1), 'purpose');
		const kekC = await deriveKek(fakePrfOutput(2), 'purpose');
		const kekD = await deriveKek(fakePrfOutput(1), 'other-purpose');

		const dek = await generateDek();
		const blob = await wrapDek(dek, kekA);
		await expect(unwrapDek(blob, kekB)).resolves.toBeDefined();
		await expect(unwrapDek(blob, kekC)).rejects.toThrow();
		await expect(unwrapDek(blob, kekD)).rejects.toThrow();
	});

	it('unwrapped DEKs are non-extractable unless explicitly requested', async () => {
		const kek = await deriveKek(fakePrfOutput(3), 'purpose');
		const dek = await generateDek();
		const blob = await wrapDek(dek, kek);

		const locked = await unwrapDek(blob, kek);
		expect(locked.extractable).toBe(false);
		const reWrappable = await unwrapDek(blob, kek, { extractable: true });
		expect(reWrappable.extractable).toBe(true);
	});

	it('rejects tampered and malformed blobs', async () => {
		const kek = await deriveKek(fakePrfOutput(4), 'purpose');
		const dek = await generateDek();
		const encrypted = await encryptJson(dek, { a: 1 });

		const [version, iv, ct] = encrypted.split('.');
		const flipped = toBase64url(
			fromBase64url(ct).map((byte, index) => (index === 0 ? byte ^ 1 : byte))
		);
		await expect(decryptJson(dek, `${version}.${iv}.${flipped}`)).rejects.toThrow();
		await expect(decryptJson(dek, 'v0.abc.def')).rejects.toThrow(/Unsupported envelope blob/);
		await expect(decryptJson(dek, 'garbage')).rejects.toThrow(/Unsupported envelope blob/);
		await expect(unwrapDek(`${version}.${toBase64url(new Uint8Array(4))}.${ct}`, kek)).rejects.toThrow(
			/bad IV length/
		);
	});
});
