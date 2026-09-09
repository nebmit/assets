import { applyOps } from './merge';

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
	assetId: string;
	/** Display-name snapshot from when the asset was added (refreshed when re-seen). */
	name: string;
	/** ISO timestamp of when the user added the asset to the list. */
	addedAt: string;
}

export interface ListDocV2 {
	v: 2;
	entries: ListEntry[];
}

/** Replayable mutation, used to merge local intent over a concurrent writer's doc. */
export type ListOp = { type: 'add'; entry: ListEntry } | { type: 'remove'; assetId: string };

export function emptyDoc(): ListDocV2 {
	return { v: 2, entries: [] };
}

/** Invalid documents fail closed rather than erasing private user data on the next save. */
export function coerceDoc(value: unknown): ListDocV2 {
	if (!value || typeof value !== 'object') throw new Error('Invalid encrypted list document');
	const doc = value as Partial<ListDocV2>;
	if (doc.v !== 2 || !Array.isArray(doc.entries)) throw new Error('Unsupported encrypted list version');
	if (!doc.entries.every((e) => e && typeof e.assetId === 'string' && e.assetId !== '' && typeof e.name === 'string' && typeof e.addedAt === 'string')) throw new Error('Invalid encrypted list entries');
	return { v: 2, entries: doc.entries };
}
export type AssetIdentifierCatalog = { assetId: string; isin: string | null }[];
const UNRESOLVED_ISIN_PREFIX = 'unresolved-isin:';

function resolveListIdentifier(assetId: string, catalog: AssetIdentifierCatalog): string {
	if (!assetId.startsWith(UNRESOLVED_ISIN_PREFIX)) return assetId;
	const isin = assetId.slice(UNRESOLVED_ISIN_PREFIX.length);
	return catalog.find((asset) => asset.isin === isin)?.assetId ?? assetId;
}

/** Resolve pending intent with the same catalog used for a concurrent document. */
export function migrateListOps(ops: ListOp[], catalog: AssetIdentifierCatalog): ListOp[] {
	return ops.map((op) => op.type === 'remove'
		? { ...op, assetId: resolveListIdentifier(op.assetId, catalog) }
		: { ...op, entry: { ...op.entry, assetId: resolveListIdentifier(op.entry.assetId, catalog) } });
}

/** One-time, entirely client-side migration; unresolved entries are kept for later matching. */
export function migrateList(value: unknown, catalog: AssetIdentifierCatalog): ListDocV2 {
	if (!value || typeof value !== 'object') throw new Error('Invalid encrypted list document');
	const doc = value as { v?: number; entries?: unknown[] };
	if (doc.v === 2) {
		return applyOps({ v: 2, entries: coerceDoc(value).entries.map((e) => ({ ...e, assetId: resolveListIdentifier(e.assetId, catalog) })) }, []);
	}
	if (doc.v !== 1 || !Array.isArray(doc.entries)) throw new Error('Unsupported encrypted list version');
	const byIsin = new Map(catalog.filter((a) => a.isin).map((a) => [a.isin, a.assetId]));
	return { v: 2, entries: doc.entries.map((v) => {
		const e = v as { isin: string; name: string; addedAt: string };
		if (!e || typeof e.isin !== 'string' || typeof e.name !== 'string' || typeof e.addedAt !== 'string') throw new Error('Invalid legacy list entry');
		return { assetId: byIsin.get(e.isin) ?? `unresolved-isin:${e.isin}`, name: e.name, addedAt: e.addedAt };
	}) };
}
