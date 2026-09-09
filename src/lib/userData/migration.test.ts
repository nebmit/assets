import { describe, expect, it } from 'vitest';
import { migrateList, migrateListOps, USER_DATA_PURPOSE } from './types.js';
import { applyOps } from './merge.js';
const assetId = '00000000-0000-4000-8000-000000000001';
const entry = { isin: 'DE0007164600', name: 'SAP', addedAt: '2020-01-02T03:04:05Z' };
const catalog = [{ assetId, isin: entry.isin }];
describe('private watchlist migration', () => {
	it('preserves timestamps and encryption purpose while converting public identifiers', () => {
		expect(migrateList({ v: 1, entries: [entry] }, catalog)).toEqual({ v: 2, entries: [{ assetId, name: entry.name, addedAt: entry.addedAt }] });
		expect(USER_DATA_PURPOSE).toBe('assets-user-data');
	});
	it('keeps unresolved entries and resolves them when the catalog later contains them', () => {
		const unresolved = migrateList({ v: 1, entries: [entry] }, []);
		expect(unresolved.entries[0].assetId).toBe(`unresolved-isin:${entry.isin}`);
		expect(migrateList(unresolved, catalog).entries[0].assetId).toBe(assetId);
	});
	it('preserves empty lists, rejects unknown documents and is idempotent', () => {
		expect(migrateList({ v: 1, entries: [] }, catalog)).toEqual({ v: 2, entries: [] });
		const migrated = migrateList({ v: 1, entries: [entry] }, catalog);
		expect(migrateList(migrated, catalog)).toEqual(migrated);
		expect(() => migrateList({ v: 3, entries: [] }, catalog)).toThrow();
		expect(() => migrateList({ v: 1, entries: [null] }, catalog)).toThrow();
	});
	it('replays only user intent over concurrently migrated documents', () => {
		const server = migrateList({ v: 1, entries: [entry] }, catalog);
		expect(applyOps(server, [{ type: 'remove', assetId }]).entries).toEqual([]);
		const removedOnAnotherDevice = migrateList({ v: 2, entries: [] }, catalog);
		expect(applyOps(removedOnAnotherDevice, []).entries).toEqual([]);
	});
	it('keeps a pending removal when another writer resolves an unknown ISIN', () => {
		const pending = [{ type: 'remove' as const, assetId: `unresolved-isin:${entry.isin}` }];
		const server = migrateList({ v: 1, entries: [entry] }, catalog);
		expect(applyOps(server, migrateListOps(pending, catalog)).entries).toEqual([]);
	});
	it('collapses newly resolved duplicates while retaining the earliest timestamp', () => {
		const doc = migrateList({ v: 2, entries: [
			{ assetId, name: 'SAP', addedAt: '2022-01-01' },
			{ assetId: `unresolved-isin:${entry.isin}`, name: entry.name, addedAt: entry.addedAt }
		] }, catalog);
		expect(doc.entries).toEqual([{ assetId, name: entry.name, addedAt: entry.addedAt }]);
	});

});
