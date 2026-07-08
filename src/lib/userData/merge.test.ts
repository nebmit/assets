import { describe, expect, it } from 'vitest';
import { applyOps } from './merge';
import type { ListDocV1, ListEntry } from './types';

function entry(isin: string, addedAt = '2026-07-01T00:00:00.000Z', name = `Name ${isin}`): ListEntry {
	return { isin, name, addedAt };
}

function doc(...entries: ListEntry[]): ListDocV1 {
	return { v: 1, entries };
}

describe('applyOps', () => {
	it('replays adds and removes over a base document', () => {
		const merged = applyOps(doc(entry('DE0007164600')), [
			{ type: 'add', entry: entry('DE0008404005') },
			{ type: 'remove', isin: 'DE0007164600' }
		]);
		expect(merged.entries.map((e) => e.isin)).toEqual(['DE0008404005']);
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
		const merged = applyOps(serverDoc, [{ type: 'remove', isin: 'DE0008404005' }]);
		expect(merged.entries.map((e) => e.isin)).toEqual(['DE0007164600']);
	});

	it('supports remove-then-re-add sequences', () => {
		const merged = applyOps(doc(entry('DE0007164600', '2026-06-01T00:00:00.000Z')), [
			{ type: 'remove', isin: 'DE0007164600' },
			{ type: 'add', entry: entry('DE0007164600', '2026-07-06T00:00:00.000Z') }
		]);
		expect(merged.entries).toEqual([entry('DE0007164600', '2026-07-06T00:00:00.000Z')]);
	});

	it('collapses duplicate isins in a malformed base document', () => {
		const merged = applyOps(
			doc(entry('DE0007164600', '2026-07-02T00:00:00.000Z'), entry('DE0007164600', '2026-07-01T00:00:00.000Z')),
			[]
		);
		expect(merged.entries).toEqual([entry('DE0007164600', '2026-07-01T00:00:00.000Z')]);
	});
});
