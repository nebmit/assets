/**
 * SSO key handoff: when a passkey ceremony runs on the SSO host
 * (core.timben) with a `prf_purpose` query parameter, the auth page
 * evaluates the PRF there and hands the output to this app in the URL
 * fragment of the post-login redirect. Fragments never reach any server,
 * and the redirect target has already passed core's subdomain allowlist —
 * so the secret only ever exists in the two browsers contexts that are
 * entitled to it.
 *
 * Wire format (all values from `URLSearchParams` over the raw fragment):
 *   #prf=<b64url 32-byte PRF output>&prf_cred=<b64url credential id>&prf_purpose=<purpose>
 *
 * This module is the single source of truth for the parameter names; the
 * emitter in core.timben (src/lib/keyHandoff.ts) pins them with a shared
 * test fixture. Keep it pure so it stays unit-testable in Node.
 */

import { fromBase64url } from './envelope';

export const HANDOFF_OUTPUT_PARAM = 'prf';
export const HANDOFF_CREDENTIAL_PARAM = 'prf_cred';
export const HANDOFF_PURPOSE_PARAM = 'prf_purpose';

const PRF_OUTPUT_BYTES = 32;
const PURPOSE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

export interface PrfHandoff {
	/** Raw 32-byte PRF output; zero it once a key has been derived. */
	prfOutput: Uint8Array;
	/** base64url WebAuthn credential id that produced the output. */
	credentialId: string;
	/** Key-derivation domain the salt was built from, e.g. 'assets-user-data'. */
	purpose: string;
}

/**
 * Parses `window.location.hash` (with or without the leading '#').
 * Returns null for anything that isn't a well-formed handoff — an ordinary
 * anchor fragment must never be mistaken for key material.
 */
export function parseHandoffFragment(hash: string): PrfHandoff | null {
	const raw = hash.startsWith('#') ? hash.slice(1) : hash;
	if (raw === '') return null;

	const params = new URLSearchParams(raw);
	const output = params.get(HANDOFF_OUTPUT_PARAM);
	const credentialId = params.get(HANDOFF_CREDENTIAL_PARAM);
	const purpose = params.get(HANDOFF_PURPOSE_PARAM);
	if (output === null || credentialId === null || purpose === null) return null;
	if (!PURPOSE_PATTERN.test(purpose)) return null;
	if (!CREDENTIAL_ID_PATTERN.test(credentialId)) return null;

	let prfOutput: Uint8Array;
	try {
		prfOutput = fromBase64url(output);
	} catch {
		return null;
	}
	if (prfOutput.length !== PRF_OUTPUT_BYTES) return null;

	return { prfOutput, credentialId, purpose };
}
