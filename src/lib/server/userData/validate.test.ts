import { describe, expect, it } from 'vitest';
import {
	MAX_CIPHERTEXT_LENGTH,
	MAX_WRAPPED_DEK_LENGTH,
	isValidCredentialId,
	isValidEnvelopeBlob,
	isValidPurpose
} from './validate.js';

describe('isValidPurpose', () => {
	it('accepts the shipped purpose', () => {
		expect(isValidPurpose('assets-user-data')).toBe(true);
	});

	it('rejects traversal, uppercase, emptiness and oversize', () => {
		expect(isValidPurpose('../etc')).toBe(false);
		expect(isValidPurpose('Assets')).toBe(false);
		expect(isValidPurpose('')).toBe(false);
		expect(isValidPurpose('-leading-dash')).toBe(false);
		expect(isValidPurpose('a'.repeat(65))).toBe(false);
		expect(isValidPurpose(42)).toBe(false);
		expect(isValidPurpose(null)).toBe(false);
	});

	it('accepts up to 64 chars', () => {
		expect(isValidPurpose('a'.repeat(64))).toBe(true);
	});
});

describe('isValidCredentialId', () => {
	it('accepts base64url ids and rejects other alphabets', () => {
		expect(isValidCredentialId('pQEC-Ay2_9xyz')).toBe(true);
		expect(isValidCredentialId('has+plus')).toBe(false);
		expect(isValidCredentialId('has=pad')).toBe(false);
		expect(isValidCredentialId('')).toBe(false);
		expect(isValidCredentialId('x'.repeat(513))).toBe(false);
	});
});

describe('isValidEnvelopeBlob', () => {
	// 16 base64url chars = the 12-byte GCM IV produced by envelope.ts.
	const iv = 'AAAAAAAAAAAAAAAA';

	it('accepts the v1 envelope wire format', () => {
		expect(isValidEnvelopeBlob(`v1.${iv}.Zm9vYmFy`, MAX_WRAPPED_DEK_LENGTH)).toBe(true);
	});

	it('rejects other versions, malformed IVs and oversized blobs', () => {
		expect(isValidEnvelopeBlob(`v2.${iv}.Zm9v`, MAX_WRAPPED_DEK_LENGTH)).toBe(false);
		expect(isValidEnvelopeBlob(`v1.${iv.slice(1)}.Zm9v`, MAX_WRAPPED_DEK_LENGTH)).toBe(false);
		expect(isValidEnvelopeBlob(`v1.${iv}.`, MAX_WRAPPED_DEK_LENGTH)).toBe(false);
		expect(isValidEnvelopeBlob(`v1.${iv}.has+plus`, MAX_WRAPPED_DEK_LENGTH)).toBe(false);
		expect(isValidEnvelopeBlob(undefined, MAX_WRAPPED_DEK_LENGTH)).toBe(false);
		const huge = `v1.${iv}.${'A'.repeat(MAX_CIPHERTEXT_LENGTH)}`;
		expect(isValidEnvelopeBlob(huge, MAX_CIPHERTEXT_LENGTH)).toBe(false);
	});
});
