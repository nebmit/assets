import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../db/index.js';
import { issuer } from '../../db/schema.js';
import { needsSubmissionsRefresh, secInsidersJob } from './jobs.js';

const transport = vi.hoisted(() => ({ fetch: vi.fn(), persist: vi.fn() }));
vi.mock('./client.js', async (original) => ({
	...await original<typeof import('./client.js')>(),
	fetchSecText: transport.fetch,
	archiveEvidence: async () => ({ path: '/fixture' })
}));
vi.mock('./store.js', async (original) => ({
	...await original<typeof import('./store.js')>(),
	persistFiling: transport.persist
}));

describe('SEC ownership queue completion', () => {
	beforeEach(() => { transport.fetch.mockReset(); transport.persist.mockReset(); });
	it('drains the queue despite an individual malformed filing', async () => {
		const updates: unknown[] = [];
		const filings = [1, 2, 3, 4].map((id) => ({ id, externalId: `filing-${id}`, form: '4', filedDate: '2026-09-07', url: `https://www.sec.gov/${id}`, attempts: 0 }));
		const db = {
			select: () => ({ from: (table: unknown) => ({ where: async () => table === issuer ? [{ id: 1, cik: '0000000001', secMetadata: { status: 'included' } }] : filings }) }),
			update: () => ({ set: (value: unknown) => { updates.push(value); return { where: async () => {} }; } })
		} as unknown as Db;
		transport.fetch.mockResolvedValueOnce('first').mockResolvedValueOnce('second').mockResolvedValueOnce('third').mockResolvedValueOnce('fourth');
		transport.persist.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('invalid filing'));
		const stats = await secInsidersJob.run({ db, runDate: '2026-09-08', log: () => {} });
		expect(stats).toEqual({ processed: 3, failed: 1, unavailable: 0, deferred: 0 });
		expect(updates).toEqual([expect.objectContaining({ status: 'error', attempts: 1, error: 'Error: invalid filing' })]);
		expect(transport.fetch).toHaveBeenCalledTimes(4);
	});
});


describe('SEC submissions checkpoints', () => {
	const metadata = { status: 'included', submissionsCheckedAt: '2026-09-08T08:00:00Z', submissionsListings: [] };
	it('skips a completed refresh and retries stale or pending issuers', () => {
		expect(needsSubmissionsRefresh(metadata, [], '2026-09-08')).toBe(false);
		expect(needsSubmissionsRefresh(metadata, [], '2026-09-16')).toBe(true);
		expect(needsSubmissionsRefresh({ ...metadata, status: 'pending' }, [], '2026-09-08')).toBe(true);
		expect(needsSubmissionsRefresh(null, [], '2026-09-08')).toBe(true);
	});
	it('does not mistake a newly observed directory for a completed submissions refresh', () => {
		const interrupted = { ...metadata, listings: [], submissionsListings: [{ symbol: 'OLD' }] };
		expect(needsSubmissionsRefresh(interrupted, [], '2026-09-08')).toBe(true);
		expect(needsSubmissionsRefresh({ ...interrupted, submissionsListings: [] }, [], '2026-09-08')).toBe(false);
	});
	it('recognizes checkpoints after PostgreSQL JSONB reorders object keys', () => {
		const current = [{ symbol: 'TEST', name: 'Common Stock', exchange: 'N', excludedReason: null }];
		const persisted = [{ name: 'Common Stock', exchange: 'N', symbol: 'TEST', excludedReason: null }];
		expect(needsSubmissionsRefresh({ ...metadata, submissionsListings: persisted }, current, '2026-09-08')).toBe(false);
	});

});
