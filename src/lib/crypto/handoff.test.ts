import { describe, expect, it } from 'vitest';
import { toBase64url } from './envelope';
import { parseHandoffFragment } from './handoff';

/**
 * Cross-repo fixture: this is byte-for-byte what core.timben's
 * `buildHandoffLocation` appends after a PRF-evaluating SSO ceremony (see
 * core.timben/src/lib/keyHandoff.test.ts, which pins the same literal).
 * If the parameter names or encoding change on either side, both tests
 * must be updated together.
 */
const FIXTURE_FRAGMENT =
	'#prf=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&prf_cred=pQEC-Ay2_w&prf_purpose=assets-user-data';

const OUTPUT_BYTES = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));

describe('parseHandoffFragment', () => {
	it('parses the cross-repo fixture', () => {
		const handoff = parseHandoffFragment(FIXTURE_FRAGMENT);
		expect(handoff).not.toBeNull();
		expect(handoff?.prfOutput).toEqual(OUTPUT_BYTES);
		expect(handoff?.credentialId).toBe('pQEC-Ay2_w');
		expect(handoff?.purpose).toBe('assets-user-data');
	});

	it('accepts the fragment without the leading #', () => {
		expect(parseHandoffFragment(FIXTURE_FRAGMENT.slice(1))).not.toBeNull();
	});

	it('ignores empty and ordinary anchor fragments', () => {
		expect(parseHandoffFragment('')).toBeNull();
		expect(parseHandoffFragment('#')).toBeNull();
		expect(parseHandoffFragment('#section-2')).toBeNull();
		expect(parseHandoffFragment('#prf=only-output')).toBeNull();
	});

	it('rejects outputs that are not exactly 32 bytes', () => {
		const short = `#prf=${toBase64url(new Uint8Array(16))}&prf_cred=abc&prf_purpose=assets-user-data`;
		const long = `#prf=${toBase64url(new Uint8Array(64))}&prf_cred=abc&prf_purpose=assets-user-data`;
		expect(parseHandoffFragment(short)).toBeNull();
		expect(parseHandoffFragment(long)).toBeNull();
	});

	it('rejects malformed purposes and credential ids', () => {
		const output = toBase64url(OUTPUT_BYTES);
		expect(
			parseHandoffFragment(`#prf=${output}&prf_cred=abc&prf_purpose=NOT-VALID`)
		).toBeNull();
		expect(
			parseHandoffFragment(`#prf=${output}&prf_cred=has%2Bplus&prf_purpose=assets-user-data`)
		).toBeNull();
	});

	it('round-trips arbitrary outputs', () => {
		const output = crypto.getRandomValues(new Uint8Array(32));
		const fragment = `#prf=${toBase64url(output)}&prf_cred=xyz_-123&prf_purpose=assets-user-data`;
		expect(parseHandoffFragment(fragment)?.prfOutput).toEqual(output);
	});
});
