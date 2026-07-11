import { describe, expect, it } from 'vitest';
import type { EquitySearchRow } from './schemas.js';
import { mapSnapshotRow } from './snapshot.js';

const RUN_DATE = '2026-07-02';

function makeRow(overrides: Partial<EquitySearchRow>): EquitySearchRow {
	return {
		isin: 'DE0007164600',
		name: { originalValue: 'SAP SE' },
		keyData: {
			earningsPerShareBasic: 5.83,
			marketCapitalisation: 1.72e11,
			dividendPerShare: 2.5,
			priceBookRatio: 5.2
		},
		overview: { lastPrice: 140.88, dateTimeLastPrice: '2026-07-01T19:56:06Z' },
		...overrides
	};
}

describe('mapSnapshotRow', () => {
	it('maps key data to fundamentals and yesterday-stamped price to a close', () => {
		const mapped = mapSnapshotRow(makeRow({}), RUN_DATE);
		expect(mapped.fundamentals).toEqual([
			{ metric: 'eps_basic', value: 5.83 },
			{ metric: 'market_cap', value: 1.72e11 },
			{ metric: 'dividend_per_share', value: 2.5 },
			{ metric: 'price_book', value: 5.2 }
		]);
		expect(mapped.close).toEqual({ tradeDate: '2026-07-01', close: 140.88 });
	});

	it('does not treat an intraday price from the run date as a close', () => {
		const mapped = mapSnapshotRow(
			makeRow({ overview: { lastPrice: 141.5, dateTimeLastPrice: '2026-07-02T09:15:00+02:00' } }),
			RUN_DATE
		);
		expect(mapped.close).toBeNull();
	});

	it('converts the price timestamp to the Berlin trading date', () => {
		// 22:30 UTC on the 1st is already the 2nd in Berlin (UTC+2) — must not
		// be booked as a 07-01 close nor accepted for a 07-02 run
		const mapped = mapSnapshotRow(
			makeRow({ overview: { lastPrice: 100, dateTimeLastPrice: '2026-07-01T22:30:00Z' } }),
			RUN_DATE
		);
		expect(mapped.close).toBeNull();
	});

	it('tolerates missing keyData and overview', () => {
		const mapped = mapSnapshotRow(makeRow({ keyData: null, overview: null }), RUN_DATE);
		expect(mapped.fundamentals).toEqual([]);
		expect(mapped.close).toBeNull();
	});
});
