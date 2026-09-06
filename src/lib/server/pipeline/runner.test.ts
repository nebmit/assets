import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/index.js';
import type { Job, JobContext } from './types.js';
import { runJobs } from './runner.js';

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
