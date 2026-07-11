import { describe, expect, it } from 'vitest';
import { planHistoryRanges, type PriceCoverage } from './prices.js';

const RUN_DATE = '2026-07-11';
const TARGET_FROM = '2023-07-11';

function coverage(overrides: Partial<PriceCoverage> = {}): PriceCoverage {
	return {
		oldest: '2024-07-11',
		newest: '2026-07-10',
		coveredFrom: null,
		...overrides
	};
}

describe('planHistoryRanges', () => {
	it('requests the full three-year window for a new instrument', () => {
		expect(
			planHistoryRanges(RUN_DATE, coverage({ oldest: null, newest: null }))
		).toEqual([{ minDate: TARGET_FROM, maxDate: RUN_DATE, kind: 'backfill' }]);
	});

	it('requests only the missing prefix for a legacy two-year instrument', () => {
		expect(planHistoryRanges(RUN_DATE, coverage())).toEqual([
			{ minDate: TARGET_FROM, maxDate: '2024-07-10', kind: 'backfill' }
		]);
	});

	it('skips a fresh instrument whose three-year window is covered', () => {
		expect(
			planHistoryRanges(
				RUN_DATE,
				coverage({ oldest: TARGET_FROM, coveredFrom: TARGET_FROM })
			)
		).toEqual([]);
	});

	it('does not retry an empty prefix for a young listing once coverage is recorded', () => {
		expect(
			planHistoryRanges(
				RUN_DATE,
				coverage({ oldest: '2025-03-20', coveredFrom: TARGET_FROM })
			)
		).toEqual([]);
		expect(
			planHistoryRanges(
				RUN_DATE,
				coverage({ oldest: null, newest: null, coveredFrom: TARGET_FROM })
			)
		).toEqual([]);
	});

	it('repairs a stale recent watermark independently', () => {
		expect(
			planHistoryRanges(
				RUN_DATE,
				coverage({ newest: '2026-07-01', coveredFrom: TARGET_FROM })
			)
		).toEqual([{ minDate: '2026-07-02', maxDate: RUN_DATE, kind: 'gap' }]);
	});

	it('plans both a missing prefix and a recent gap when necessary', () => {
		expect(planHistoryRanges(RUN_DATE, coverage({ newest: '2026-07-01' }))).toEqual([
			{ minDate: TARGET_FROM, maxDate: '2024-07-10', kind: 'backfill' },
			{ minDate: '2026-07-02', maxDate: RUN_DATE, kind: 'gap' }
		]);
	});
});
