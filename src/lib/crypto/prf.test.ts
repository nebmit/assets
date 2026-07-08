import { describe, expect, it } from 'vitest';
import { defaultRpId, prfSalt } from './prf';

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('prfSalt', () => {
	/**
	 * Cross-repo contract: core.timben evaluates the PRF over this exact salt
	 * during SSO sign-in and hands the output to this app (see
	 * core.timben/src/lib/prf.test.ts, which pins the same vectors). If either
	 * side drifts — prefix, hash, or encoding — the derived keys diverge and
	 * every stored watchlist becomes unreadable. Never change these values.
	 */
	it('matches the pinned cross-repo vector for the shipped purpose', async () => {
		expect(toHex(await prfSalt('assets-user-data'))).toBe(
			'806e7f8183da9710ae58adf701f2b8949e1442b65b54214eebd304bdfa473a75'
		);
	});

	it('matches the pinned cross-repo vector for a generic purpose', async () => {
		expect(toHex(await prfSalt('example-purpose'))).toBe(
			'595171073e27d3494761657fbd830a1cbe930c7702f6c84693650af814aba5cc'
		);
	});

	it('yields 32 bytes', async () => {
		expect((await prfSalt('anything')).length).toBe(32);
	});
});

describe('defaultRpId', () => {
	it('uses the registrable parent domain in production', () => {
		expect(defaultRpId('assets.timben.net')).toBe('timben.net');
		expect(defaultRpId('timben.net')).toBe('timben.net');
	});

	it('stays on localhost in development', () => {
		expect(defaultRpId('localhost')).toBe('localhost');
		expect(defaultRpId('127.0.0.1')).toBe('localhost');
	});
});
