import { describe, expect, it } from 'vitest';
import { allJobs, selectJobs } from './jobs.js';

describe('daily worker registry', () => {
	it('includes SEC by default before combined results and preserves SEC dependency order', () => {
		const jobs = selectJobs();
		expect(jobs).toEqual(allJobs);
		expect(new Set(jobs.map((job) => job.name)).size).toBe(jobs.length);
		expect(jobs.filter((job) => job.source === 'sec').map((job) => job.name)).toEqual(['sec_universe', 'sec_filings', 'sec_fundamentals', 'sec_insiders']);
		expect(jobs.findIndex((job) => job.name === 'signals')).toBeGreaterThan(jobs.findIndex((job) => job.name === 'sec_fundamentals'));
	});
	it('uses source as an optional filter and validates individual jobs', () => {
		expect(selectJobs('all', 'sec')).toEqual(allJobs.filter((job) => job.source === 'sec'));
		expect(selectJobs('sec_filings').map((job) => job.name)).toEqual(['sec_filings']);
		expect(() => selectJobs('signals', 'sec')).toThrow('does not belong');
		expect(() => selectJobs('all', 'missing')).toThrow('unknown source');
		expect(() => selectJobs('missing')).toThrow('unknown job');
	});
	it('inserts weekly reconciliation after universe discovery in both combined and filtered schedules', () => {
		for (const source of [undefined, 'sec']) {
			const names = selectJobs('all', source, true).map((job) => job.name);
			expect(names.slice(names.indexOf('sec_universe'), names.indexOf('sec_filings') + 1)).toEqual(['sec_universe', 'sec_reconcile', 'sec_filings']);
		}
		expect(selectJobs('sec_filings', undefined, true).map((job) => job.name)).toEqual(['sec_filings']);
	});
});
