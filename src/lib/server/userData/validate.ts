/**
 * Request validation for the user-data API. The server stores wrapped keys
 * and encrypted documents without ever being able to read them, so
 * validation is purely structural: enforce the envelope wire format and
 * sane sizes, never parse further — the envelope layout can then evolve
 * client-only (v2, …) behind the same version prefix discipline.
 */

/** Key-derivation domain labels, e.g. 'assets-user-data'. */
const PURPOSE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Envelope blobs from src/lib/crypto/envelope.ts: "v1.<b64url iv>.<b64url
 * ciphertext>" with a 12-byte IV (16 base64url chars, unpadded).
 */
const ENVELOPE_PATTERN = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/;

/** base64url credential ids as reported by WebAuthn (bounded like core's column). */
const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

/** A wrapped 32-byte DEK is ~80 chars; leave generous headroom. */
export const MAX_WRAPPED_DEK_LENGTH = 2 * 1024;

/** Encrypted watchlist-sized documents; caps abuse, not legitimate use. */
export const MAX_CIPHERTEXT_LENGTH = 256 * 1024;

export function isValidPurpose(value: unknown): value is string {
	return typeof value === 'string' && PURPOSE_PATTERN.test(value);
}

export function isValidCredentialId(value: unknown): value is string {
	return typeof value === 'string' && CREDENTIAL_ID_PATTERN.test(value);
}

export function isValidEnvelopeBlob(value: unknown, maxLength: number): value is string {
	return typeof value === 'string' && value.length <= maxLength && ENVELOPE_PATTERN.test(value);
}
