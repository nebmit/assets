import { describe, expect, it } from 'vitest';
import { evaluateSignals, rankResults, SURFACED_SLUG } from './engine.js';
import type { UniverseContext, UniverseInstrument } from './types.js';

describe('rankResults', () => {
	it('ranks gate-passers by score and leaves non-passers unranked', () => {
		const ranked = rankResults([
			{ instrumentId: 1, passedGate: true, score: 10, rationale: {} },
			{ instrumentId: 2, passedGate: false, score: null, rationale: {} },
			{ instrumentId: 3, passedGate: true, score: 30, rationale: {} }
		]);
		const byId = new Map(ranked.map((r) => [r.instrumentId, r]));
		expect(byId.get(3)).toMatchObject({ rank: 1, percentile: 1 });
		expect(byId.get(1)).toMatchObject({ rank: 2, percentile: 0.5 });
		expect(byId.get(2)).toMatchObject({ rank: null, percentile: null });
	});
});

describe('evaluateSignals surfaced feed', () => {
	function makeInstrument(id: number, overrides: Partial<UniverseInstrument>): UniverseInstrument {
		return {
			instrumentId: id,
			issuerId: id,
			isin: `DE${String(id).padStart(10, '0')}`,
			ticker: `T${id}`,
			name: `Company ${id}`,
			sector: 'Industrial products',
			indexName: 'DAX',
			close: 100,
			closeDate: '2026-07-02',
			epsBasic: 10,
			marketCap: 1e9,
			dividendPerShare: null,
			priceToBook: null,
			return3m: null,
			return6m: null,
			drawdown52w: null,
			above52wLow: null,
			insiderTx: [],
			...overrides
		};
	}
	/** Material buy: well above the 100k DAX floor even after decay. */
	const bigBuy = {
		partyName: 'B',
		partyRole: 'executive_board' as const,
		side: 'buy' as const,
		instrumentType: 'Aktie',
		amount: 400_000,
		transactionDate: '2026-07-01',
		publishedDate: '2026-07-01'
	};

	function ctxOf(instruments: UniverseInstrument[]): UniverseContext {
		return { runDate: '2026-07-02', instruments };
	}

	it('surfaces the union: any single fired signal is enough', () => {
		// cheap only (P/E 5 vs peer median 20), no insider activity
		const cheap = makeInstrument(1, { close: 50 });
		// insider buy only, unrankable P/E (negative earnings)
		const bought = makeInstrument(2, { epsBasic: -1, insiderTx: [bigBuy] });
		// nothing fired
		const quiet = makeInstrument(3, { close: 190 });
		const peers = [4, 5, 6, 7, 8].map((id) => makeInstrument(id, { close: 200 }));
		const results = evaluateSignals(ctxOf([cheap, bought, quiet, ...peers]));
		const surfaced = new Map(results.get(SURFACED_SLUG)?.map((r) => [r.instrumentId, r]));

		expect(surfaced.get(1)?.passedGate).toBe(true);
		expect(surfaced.get(2)?.passedGate).toBe(true);
		expect(surfaced.get(3)?.passedGate).toBe(false);

		const cheapReasons = surfaced.get(1)?.rationale.reasons as { signal: string }[];
		expect(cheapReasons.map((r) => r.signal)).toEqual(['relative_value']);
		const boughtReasons = surfaced.get(2)?.rationale.reasons as { signal: string; headline: string }[];
		expect(boughtReasons.map((r) => r.signal)).toEqual(['insider_conviction']);
		expect(boughtReasons[0].headline).toContain('insider');
	});

	it('combines confirmations via noisy-or: both signals beat either alone', () => {
		const both = makeInstrument(1, { close: 50, insiderTx: [bigBuy] });
		const peers = [2, 3, 4, 5, 6].map((id) => makeInstrument(id, { close: 200 }));
		const results = evaluateSignals(ctxOf([both, ...peers]));
		const surfacedRow = results.get(SURFACED_SLUG)?.find((r) => r.instrumentId === 1);

		expect(surfacedRow?.passedGate).toBe(true);
		const insider = surfacedRow?.rationale.insider_conviction_severity as number;
		const value = surfacedRow?.rationale.relative_value_severity as number;
		expect(insider).toBeGreaterThan(0);
		expect(value).toBeGreaterThan(0);
		expect(surfacedRow?.score).toBeCloseTo(1 - (1 - insider) * (1 - value));
		expect(surfacedRow?.score as number).toBeGreaterThan(Math.max(insider, value));
	});

	it('yields an empty feed on a quiet day instead of grading survivors on a curve', () => {
		// valid P/Es near the median, no insider activity: nothing is interesting
		const instruments = [1, 2, 3, 4, 5, 6].map((id) => makeInstrument(id, { close: 95 + id }));
		const results = evaluateSignals(ctxOf(instruments));
		const surfaced = results.get(SURFACED_SLUG) ?? [];
		expect(surfaced.every((r) => !r.passedGate)).toBe(true);
	});

	it('propagates the newest event date of fired event signals', () => {
		const bought = makeInstrument(1, {
			epsBasic: -1,
			insiderTx: [bigBuy, { ...bigBuy, partyName: 'C', publishedDate: '2026-06-20', transactionDate: '2026-06-19' }]
		});
		const results = evaluateSignals(ctxOf([bought]));
		const row = results.get(SURFACED_SLUG)?.find((r) => r.instrumentId === 1);
		expect(row?.rationale.event_date).toBe('2026-07-01');
	});
});
