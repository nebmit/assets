import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/index.js';
import type { Job, JobContext } from './types.js';
import { runJob, runJobs } from './runner.js';

const lock = vi.hoisted(() => {
	const query = Object.assign(vi.fn(), { end: vi.fn() });
	return { query };
});
vi.mock('postgres', () => ({ default: () => lock.query }));

// Only bookkeeping is stubbed; real orchestration executes the supplied jobs.
const db = {
	insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }),
	update: () => ({ set: () => ({ where: async () => {} }) })
} as unknown as Db;
const job = (name: string, run: Job['run'], source = 'sec'): Job => ({ name, source, run });

describe('combined pipeline execution', () => {
	beforeEach(() => { vi.restoreAllMocks(); lock.query.mockReset().mockResolvedValue([{ acquired: true }]); lock.query.end.mockReset(); });
	it('shares a default index selection across SEC stages without passing it to German jobs', async () => {
		const contexts: JobContext[] = [];
		const run: Job['run'] = async (ctx) => { contexts.push(ctx); return {}; };
		const results = await runJobs(db, [job('german', run, 'german'), job('sec_universe', run), job('sec_filings', run)], '2026-09-06');
		expect(results.every((r) => r.ok)).toBe(true);
		expect(contexts[0].issuerSelection).toBeUndefined();
		expect(contexts[1].issuerSelection?.indices).toEqual(['sp400', 'sp500']);
		expect(contexts[2].issuerSelection).toBe(contexts[1].issuerSelection);
		expect(lock.query).toHaveBeenCalledOnce();
		expect(lock.query.end).toHaveBeenCalledOnce();
	});
	it('skips dependent SEC stages after discovery failure and still runs other sources', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const dependent = vi.fn(async () => ({})), other = vi.fn(async () => ({}));
		const results = await runJobs(db, [job('sec_universe', async () => { throw new Error('source unavailable'); }), job('sec_filings', dependent), job('other', other, 'german')], '2026-09-06');
		expect(results.map((r) => r.ok)).toEqual([false, false, true]);
		expect(dependent).not.toHaveBeenCalled();
		expect(other).toHaveBeenCalledOnce();
		expect(lock.query.end).toHaveBeenCalledOnce();
	});
	it.each(['source_failure', 'incomplete_queue'])('retains the published snapshot after SEC %s while other sources finish', async (failure) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const other = vi.fn(async () => ({})), signals = vi.fn(async () => ({})), performance = vi.fn(async () => ({}));
		const results = await runJobs(db, [job('sec_universe', async () => {
			if (failure === 'source_failure') throw new Error('Invalid equity holding ticker');
			return { failed: 1, pending: 2 };
		}), job('alpaca_prices', other, 'alpaca'), job('signals', signals, 'internal'), job('performance', performance, 'internal')], '2026-09-09');
		expect(results.map((r) => r.ok)).toEqual([false, true, false, false]);
		expect(other).toHaveBeenCalledOnce();
		expect(signals).not.toHaveBeenCalled(); expect(performance).not.toHaveBeenCalled();
		expect(results[2].error).toContain('retain the previous dashboard snapshot');
	});
	it('waits for long-running work instead of publishing a budget-truncated stage', async () => {
		const next = vi.fn(async () => ({}));
		const result = await runJobs(db, [job('sec_filings', async () => {
			vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3600000);
			return { processed: 10000, deferred: 0 };
		}), job('sec_fundamentals', next)], '2026-09-06');
		expect(result.every((r) => r.ok)).toBe(true);
		expect(next).toHaveBeenCalledOnce();
	});
	it('does not hide a source failure', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await runJob(db, job('sec_universe', async () => { throw new Error('invalid source snapshot'); }), '2026-09-06');
		expect(result).toMatchObject({ ok: false, error: expect.stringContaining('invalid source snapshot') });
	});
	it.each([
		[{ refreshed: 399, refresh_missing: 0, deferred: 498 }, false],
		[{ refreshed: 399, refresh_missing: 498, deferred: 0 }, false],
		[{ failed: 2, deferred: 498 }, false]
	])('reports remaining work and filing failures as incomplete', async (stats, ok) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await runJob(db, job('sec_universe', async () => stats), '2026-09-06');
		expect(result.ok).toBe(ok);
		expect(result.stats).toMatchObject(stats);
	});
	it('isolates SEC lock contention from other sources', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		lock.query.mockResolvedValue([{ acquired: false }]);
		const sec = vi.fn(async () => ({})), other = vi.fn(async () => ({}));
		const results = await runJobs(db, [job('sec_universe', sec), job('other', other, 'german')], '2026-09-06');
		expect(results.map((r) => r.ok)).toEqual([false, true]);
		expect(sec).not.toHaveBeenCalled();
		expect(other).toHaveBeenCalledOnce();
		expect(lock.query.end).toHaveBeenCalledOnce();
	});
});

it('publishes healthy snapshots after item-level SEC failures', async () => {
	lock.query.mockResolvedValue([{ acquired: true }]);
	const signals = vi.fn(async () => ({}));
	const results = await runJobs(db, [job('sec_fundamentals', async () => ({ failed: 1, processed: 100 })), job('signals', signals, 'internal')], '2026-09-09');
	expect(results.map((r) => r.ok)).toEqual([false, true]);
	expect(signals).toHaveBeenCalledOnce();
});
