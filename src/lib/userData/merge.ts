/**
 * Conflict resolution for concurrent list writers (two tabs, two devices).
 * The client keeps a log of not-yet-acknowledged ops; when a save loses the
 * version race, the server's winning document is decrypted and the local
 * ops are replayed over it. Ops are idempotent, so replaying an
 * already-applied op is harmless.
 */

import type { ListDocV1, ListEntry, ListOp } from './types';

/** Replays local ops over a base document. Pure; returns a new doc. */
export function applyOps(doc: ListDocV1, ops: ListOp[]): ListDocV1 {
	const byIsin = new Map<string, ListEntry>();
	for (const entry of doc.entries) {
		const existing = byIsin.get(entry.isin);
		// Duplicate isins shouldn't exist, but if they do, keep the earliest add.
		if (existing === undefined || entry.addedAt < existing.addedAt) {
			byIsin.set(entry.isin, entry);
		}
	}
	for (const op of ops) {
		if (op.type === 'remove') {
			byIsin.delete(op.isin);
			continue;
		}
		const existing = byIsin.get(op.entry.isin);
		if (existing === undefined) {
			byIsin.set(op.entry.isin, op.entry);
		} else {
			// Already present (e.g. added on another device first): keep the
			// earliest addedAt but adopt the fresher name snapshot.
			byIsin.set(op.entry.isin, {
				...existing,
				addedAt: existing.addedAt < op.entry.addedAt ? existing.addedAt : op.entry.addedAt,
				name: op.entry.name
			});
		}
	}
	return { v: 1, entries: [...byIsin.values()] };
}
