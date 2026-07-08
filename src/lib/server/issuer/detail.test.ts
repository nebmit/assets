import { describe, expect, it } from 'vitest';
import type { InsiderDealingView } from '../mcp/enrich.js';
import { computeFollowThrough, downsampleMonthly, type PricePoint } from './detail.js';

const RUN_DATE = '2026-07-01';

function makeDealing(overrides: Partial<InsiderDealingView>): InsiderDealingView {
	return {
		party: 'Armin Example',
		role: 'executive_board',
		roleWeight: 1,
		side: 'buy',
		dealingType: 'open_market_purchase',
		instrumentType: 'Aktie',
		countedInSignal: true,
		amountEur: 100_000,
		price: 80,
		transactionDate: '2026-01-05',
		publishedDate: '2026-01-06',
		decayedWeightEur: null,
		...overrides
	};
}

/** One close per weekday-ish day between two dates at a linear drift. */
function series(from: string, days: number, startClose: number, dailyDelta: number): PricePoint[] {
	const out: PricePoint[] = [];
	const start = new Date(`${from}T12:00:00Z`);
	for (let i = 0; i < days; i++) {
		const d = new Date(start);
		d.setUTCDate(d.getUTCDate() + i);
		out.push({ date: d.toISOString().slice(0, 10), close: startClose + i * dailyDelta });
	}
	return out;
}

describe('downsampleMonthly', () => {
	it('keeps the last close per calendar month, ascending', () => {
		const closes = [
			{ date: '2026-05-04', close: 10 },
			{ date: '2026-05-29', close: 11 },
			{ date: '2026-06-01', close: 12 },
			{ date: '2026-06-30', close: 13 }
		];
		expect(downsampleMonthly(closes)).toEqual([
			{ date: '2026-05-29', close: 11 },
			{ date: '2026-06-30', close: 13 }
		]);
	});
});

describe('computeFollowThrough', () => {
	it('measures the ~91-day forward return per counted buy', () => {
		const closes = series('2026-01-01', 200, 100, 0.5); // steadily rising
		const [party] = computeFollowThrough([makeDealing({})], closes, RUN_DATE);
		expect(party.party).toBe('Armin Example');
		expect(party.buyCount).toBe(1);
		const buy = party.buys[0];
		// bought at ~102, 91 days later ~147.5 → strongly positive
		expect(buy.fwdReturn91d).toBeGreaterThan(0.4);
	});

	it('returns null when the horizon has not elapsed by the run date', () => {
		const closes = series('2026-01-01', 200, 100, 0);
		const [party] = computeFollowThrough(
			[makeDealing({ transactionDate: '2026-06-20' })],
			closes,
			RUN_DATE
		);
		expect(party.buys[0].fwdReturn91d).toBeNull();
	});

	it('groups by named party and skips unnamed, non-buy and non-counted dealings', () => {
		const closes = series('2026-01-01', 200, 100, 0);
		const parties = computeFollowThrough(
			[
				makeDealing({}),
				makeDealing({ transactionDate: '2026-02-10' }),
				makeDealing({ party: 'Second Buyer', role: 'supervisory_board' }),
				makeDealing({ party: null }),
				makeDealing({ side: 'sell', dealingType: 'sale' }),
				makeDealing({ side: 'other', dealingType: 'settlement_or_award', countedInSignal: false })
			],
			closes,
			RUN_DATE
		);
		expect(parties.map((p) => [p.party, p.buyCount])).toEqual([
			['Armin Example', 2],
			['Second Buyer', 1]
		]);
	});

	it('yields null returns when closes are missing around the buy', () => {
		const [party] = computeFollowThrough([makeDealing({ transactionDate: '2020-01-01' })], [], RUN_DATE);
		expect(party.buys[0].fwdReturn91d).toBeNull();
	});
});
