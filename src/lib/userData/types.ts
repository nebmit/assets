/**
 * Domain types for the user's asset lists. The watchlist is encrypted
 * client-side and stored as an opaque blob (the server must never learn
 * what's on it); the ignore list is plaintext on the server so the MCP
 * tools can filter by it. Both snapshot the asset name at add-time so the
 * management lists can render assets that aren't in the current feed.
 */

/**
 * Key-derivation domain for all user-owned data in this app. Determines the
 * PRF salt and the HKDF info; changing it derives a different KEK and
 * orphans every wrapped DEK (see src/lib/crypto/README.md). Never rotate.
 */
export const USER_DATA_PURPOSE = 'assets-user-data';

/** Server-side document name under /api/user-blobs/. */
export const WATCHLIST_BLOB_NAME = 'watchlist';

export interface ListEntry {
	isin: string;
	/** Display-name snapshot from when the asset was added (refreshed when re-seen). */
	name: string;
	/** ISO timestamp of when the user added the asset to the list. */
	addedAt: string;
}

export interface ListDocV1 {
	v: 1;
	entries: ListEntry[];
}

/** Replayable mutation, used to merge local intent over a concurrent writer's doc. */
export type ListOp = { type: 'add'; entry: ListEntry } | { type: 'remove'; isin: string };

export function emptyDoc(): ListDocV1 {
	return { v: 1, entries: [] };
}

/** Defensive parse of a decrypted document; malformed content degrades to empty. */
export function coerceDoc(value: unknown): ListDocV1 {
	if (typeof value !== 'object' || value === null) return emptyDoc();
	const doc = value as Partial<ListDocV1>;
	if (doc.v !== 1 || !Array.isArray(doc.entries)) return emptyDoc();
	const entries = doc.entries.filter(
		(e): e is ListEntry =>
			typeof e === 'object' &&
			e !== null &&
			typeof e.isin === 'string' &&
			e.isin !== '' &&
			typeof e.name === 'string' &&
			typeof e.addedAt === 'string'
	);
	return { v: 1, entries };
}
