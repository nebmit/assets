import { describe, expect, it } from 'vitest';
import { applyOps } from './merge';
import type { ListDocV2, ListEntry } from './types';

function entry(assetId: string, addedAt = '2026-07-01T00:00:00.000Z', name = `Name ${assetId}`): ListEntry {
	return { assetId, name, addedAt };
}

function doc(...entries: ListEntry[]): ListDocV2 {
	return { v: 2, entries };
}

describe('applyOps', () => {
	it('replays adds and removes over a base document', () => {
		const merged = applyOps(doc(entry('DE0007164600')), [
			{ type: 'add', entry: entry('DE0008404005') },
			{ type: 'remove', assetId: 'DE0007164600' }
		]);
		expect(merged.entries.map((e) => e.assetId)).toEqual(['DE0008404005']);
	});

	it('is idempotent for already-applied ops', () => {
		const base = doc(entry('DE0007164600'));
		const ops = [{ type: 'add', entry: entry('DE0007164600') } as const];
		expect(applyOps(applyOps(base, ops), ops).entries).toHaveLength(1);
	});

	it('keeps the earliest addedAt but adopts the fresher name on duplicate adds', () => {
		const merged = applyOps(doc(entry('DE0007164600', '2026-07-01T00:00:00.000Z', 'Old Name')), [
			{ type: 'add', entry: entry('DE0007164600', '2026-07-05T00:00:00.000Z', 'New Name') }
		]);
		expect(merged.entries).toEqual([entry('DE0007164600', '2026-07-01T00:00:00.000Z', 'New Name')]);
	});

	it('lets a local remove win over a concurrent remote add', () => {
		const serverDoc = doc(entry('DE0007164600'), entry('DE0008404005'));
		const merged = applyOps(serverDoc, [{ type: 'remove', assetId: 'DE0008404005' }]);
		expect(merged.entries.map((e) => e.assetId)).toEqual(['DE0007164600']);
	});

	it('supports remove-then-re-add sequences', () => {
		const merged = applyOps(doc(entry('DE0007164600', '2026-06-01T00:00:00.000Z')), [
			{ type: 'remove', assetId: 'DE0007164600' },
			{ type: 'add', entry: entry('DE0007164600', '2026-07-06T00:00:00.000Z') }
		]);
		expect(merged.entries).toEqual([entry('DE0007164600', '2026-07-06T00:00:00.000Z')]);
	});

	it('collapses duplicate assetIds in a malformed base document', () => {
		const merged = applyOps(
			doc(entry('DE0007164600', '2026-07-02T00:00:00.000Z'), entry('DE0007164600', '2026-07-01T00:00:00.000Z')),
			[]
		);
		expect(merged.entries).toEqual([entry('DE0007164600', '2026-07-01T00:00:00.000Z')]);
	});
});
