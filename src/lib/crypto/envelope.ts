/**
 * Envelope encryption on top of Web Crypto, keyed by a WebAuthn PRF output
 * (see ./prf.ts). Pure and environment-agnostic: everything here runs against
 * `globalThis.crypto` and is unit-testable in Node.
 *
 * Layout: a random data-encryption key (DEK) encrypts the actual payloads;
 * the DEK is wrapped by a key-encryption key (KEK) derived from a passkey's
 * PRF output. Each enrolled passkey yields a different PRF output, so the
 * same DEK is wrapped once per passkey — losing every passkey means the data
 * is cryptographically unrecoverable (there is no password fallback by
 * design).
 *
 * All blobs are versioned strings ("v1.<b64url iv>.<b64url ciphertext>") so
 * the format can evolve without guessing.
 */

const VERSION = 'v1';
const GCM_IV_BYTES = 12;

export function toBase64url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(value: string): Uint8Array {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * Derives an AES-GCM-256 key-encryption key from a PRF output. HKDF-SHA256
 * with a zero salt (the PRF output is already uniform); domain separation
 * lives in `info`, so distinct purposes derive unrelated keys from the same
 * ceremony.
 */
export async function deriveKek(prfOutput: Uint8Array, info: string): Promise<CryptoKey> {
	const ikm = await crypto.subtle.importKey('raw', prfOutput as Uint8Array<ArrayBuffer>, 'HKDF', false, [
		'deriveKey'
	]);
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(32),
			info: new TextEncoder().encode(info)
		},
		ikm,
		{ name: 'AES-GCM', length: 256 },
		false,
		['wrapKey', 'unwrapKey']
	);
}

/** Random AES-GCM-256 data-encryption key; extractable so it can be wrapped. */
export function generateDek(): Promise<CryptoKey> {
	return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Wraps the DEK under a KEK; store the result per enrolled passkey. */
export async function wrapDek(dek: CryptoKey, kek: CryptoKey): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
	const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
	return `${VERSION}.${toBase64url(iv)}.${toBase64url(new Uint8Array(wrapped))}`;
}

/**
 * Unwraps a stored DEK blob. Pass `extractable: true` only when the DEK must
 * be re-wrapped afterwards (enrolling an additional passkey); everyday
 * decryption should keep the key non-extractable.
 */
export async function unwrapDek(
	blob: string,
	kek: CryptoKey,
	options: { extractable?: boolean } = {}
): Promise<CryptoKey> {
	const { iv, payload } = parseBlob(blob);
	return crypto.subtle.unwrapKey(
		'raw',
		payload as Uint8Array<ArrayBuffer>,
		kek,
		{ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> },
		{ name: 'AES-GCM', length: 256 },
		options.extractable === true,
		['encrypt', 'decrypt']
	);
}

/** Encrypts a JSON-serializable value under the DEK. */
export async function encryptJson(dek: CryptoKey, value: unknown): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
	const plaintext = new TextEncoder().encode(JSON.stringify(value));
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, plaintext);
	return `${VERSION}.${toBase64url(iv)}.${toBase64url(new Uint8Array(ciphertext))}`;
}

export async function decryptJson<T = unknown>(dek: CryptoKey, blob: string): Promise<T> {
	const { iv, payload } = parseBlob(blob);
	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> },
		dek,
		payload as Uint8Array<ArrayBuffer>
	);
	return JSON.parse(new TextDecoder().decode(plaintext));
}

function parseBlob(blob: string): { iv: Uint8Array; payload: Uint8Array } {
	const parts = blob.split('.');
	if (parts.length !== 3 || parts[0] !== VERSION) {
		throw new Error(`Unsupported envelope blob (expected "${VERSION}.<iv>.<payload>")`);
	}
	const iv = fromBase64url(parts[1]);
	if (iv.length !== GCM_IV_BYTES) {
		throw new Error('Unsupported envelope blob (bad IV length)');
	}
	return { iv, payload: fromBase64url(parts[2]) };
}
