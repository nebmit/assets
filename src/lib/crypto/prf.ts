/**
 * WebAuthn PRF ceremony for client-side key derivation. Browser-only: this
 * runs `navigator.credentials.get()` against the shared timben.net passkeys
 * (registered PRF-capable by the SSO host), asks the authenticator to
 * evaluate its PRF over a purpose-specific salt, and hands the 32-byte
 * output to ./envelope.ts for HKDF → AES-GCM.
 *
 * No server verification is involved — the assertion signature is discarded;
 * the value of the ceremony is the PRF output, which the authenticator only
 * releases after user verification. Callers must invoke this from a user
 * gesture (click handler): browsers require transient activation for
 * credential prompts.
 */

import { deriveKek } from './envelope';

/** Thrown when the ceremony ran but the credential/client cannot do PRF. */
export class PrfNotAvailableError extends Error {
	constructor() {
		super(
			'This passkey or browser did not return a PRF result. ' +
				'Synced platform passkeys (iCloud Keychain, Google Password Manager) on current browsers are the reliable path.'
		);
		this.name = 'PrfNotAvailableError';
	}
}

/** Cheap static check; the definitive answer only comes from a ceremony. */
export function webauthnSupported(): boolean {
	return typeof window !== 'undefined' && 'credentials' in navigator && 'PublicKeyCredential' in window;
}

/**
 * The RP ID the SSO passkeys are scoped to: the registrable parent domain in
 * production (so every *.timben.net app reaches the same credentials),
 * localhost in development — mirroring RP_ID in core.timben.
 */
export function defaultRpId(hostname: string = window.location.hostname): string {
	if (hostname === 'localhost' || hostname === '127.0.0.1') {
		return 'localhost';
	}
	return hostname.split('.').slice(-2).join('.');
}

/**
 * Deterministic PRF salt for a named purpose. The purpose string is the only
 * input, so the same purpose always reaches the same PRF output for a given
 * passkey — which is what makes the derived key re-derivable on any device.
 */
export async function prfSalt(purpose: string): Promise<Uint8Array> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`timben.net/prf/v1/${purpose}`));
	return new Uint8Array(digest);
}

export interface PrfCeremonyOptions {
	/** Purpose label; also becomes the HKDF domain separator. */
	purpose: string;
	/** Defaults to the registrable domain of the current host. */
	rpId?: string;
	/** Restrict the picker to known credentials; empty = any discoverable. */
	credentialIds?: Uint8Array[];
}

/**
 * Runs the PRF ceremony and returns the raw 32-byte PRF output. Prefer
 * `derivePrfKek` unless you need the output itself.
 */
export async function evaluatePrf(options: PrfCeremonyOptions): Promise<Uint8Array> {
	const salt = await prfSalt(options.purpose);
	const credential = (await navigator.credentials.get({
		publicKey: {
			// The challenge is not server-verified (nothing is asserted to a
			// server); it still must be fresh randomness per the API contract.
			challenge: crypto.getRandomValues(new Uint8Array(32)),
			rpId: options.rpId ?? defaultRpId(),
			userVerification: 'required',
			allowCredentials: (options.credentialIds ?? []).map((id) => ({
				type: 'public-key' as const,
				id: id as Uint8Array<ArrayBuffer>
			})),
			extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs
		}
	})) as PublicKeyCredential | null;

	const results = credential?.getClientExtensionResults() as
		| { prf?: { results?: { first?: ArrayBuffer } } }
		| undefined;
	const first = results?.prf?.results?.first;
	if (!first) {
		throw new PrfNotAvailableError();
	}
	return new Uint8Array(first);
}

/**
 * One-stop ceremony → key-encryption key. The KEK wraps/unwraps the DEK
 * stored (wrapped) on the server; see ./envelope.ts for the full pattern.
 */
export async function derivePrfKek(options: PrfCeremonyOptions): Promise<CryptoKey> {
	const output = await evaluatePrf(options);
	return deriveKek(output, options.purpose);
}
