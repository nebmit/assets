/**
 * Conflict resolution for concurrent list writers (two tabs, two devices).
 * The client keeps a log of not-yet-acknowledged ops; when a save loses the
 * version race, the server's winning document is decrypted and the local
 * ops are replayed over it. Ops are idempotent, so replaying an
 * already-applied op is harmless.
 */

import type { ListDocV2, ListEntry, ListOp } from './types';

/** Replays local ops over a base document. Pure; returns a new doc. */
export function applyOps(doc: ListDocV2, ops: ListOp[]): ListDocV2 {
	const byAssetId = new Map<string, ListEntry>();
	for (const entry of doc.entries) {
		const existing = byAssetId.get(entry.assetId);
		// Duplicate assetIds shouldn't exist, but if they do, keep the earliest add.
		if (existing === undefined || entry.addedAt < existing.addedAt) {
			byAssetId.set(entry.assetId, entry);
		}
	}
	for (const op of ops) {
		if (op.type === 'remove') {
			byAssetId.delete(op.assetId);
			continue;
		}
		const existing = byAssetId.get(op.entry.assetId);
		if (existing === undefined) {
			byAssetId.set(op.entry.assetId, op.entry);
		} else {
			// Already present (e.g. added on another device first): keep the
			// earliest addedAt but adopt the fresher name snapshot.
			byAssetId.set(op.entry.assetId, {
				...existing,
				addedAt: existing.addedAt < op.entry.addedAt ? existing.addedAt : op.entry.addedAt,
				name: op.entry.name
			});
		}
	}
	return { v: 2, entries: [...byAssetId.values()] };
}
