import { describe, expect, it } from 'vitest';
import { COMPOSITE_SLUG, evaluateScreens, rankResults } from './engine.js';
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

describe('evaluateScreens composite', () => {
	function makeInstrument(id: number, overrides: Partial<UniverseInstrument>): UniverseInstrument {
		return {
			instrumentId: id,
			issuerId: id,
			isin: `DE${String(id).padStart(10, '0')}`,
			ticker: `T${id}`,
			name: `Company ${id}`,
			sector: 'Industrial',
			indexName: 'DAX',
			close: 100,
			closeDate: '2026-07-02',
			epsBasic: 10,
			marketCap: 1e9,
			insiderTx: [],
			...overrides
		};
	}
	const buy = {
		partyName: 'B',
		partyRole: 'executive_board' as const,
		side: 'buy' as const,
		instrumentType: 'Aktie',
		amount: 100_000,
		transactionDate: '2026-07-01',
		publishedDate: '2026-07-01'
	};

	it('passes only instruments passing both component gates, equal-weighted', () => {
		const both = makeInstrument(1, { close: 50, insiderTx: [buy] }); // cheap + insider buy
		const valueOnly = makeInstrument(2, { close: 80 });
		const neither = makeInstrument(3, { epsBasic: -1 });
		const ctx: UniverseContext = { runDate: '2026-07-02', instruments: [both, valueOnly, neither] };

		const results = evaluateScreens(ctx);
		const composite = new Map(results.get(COMPOSITE_SLUG)?.map((r) => [r.instrumentId, r]));
		expect(composite.get(1)?.passedGate).toBe(true);
		expect(composite.get(1)?.rank).toBe(1);
		expect(composite.get(2)?.passedGate).toBe(false);
		expect(composite.get(3)?.passedGate).toBe(false);
		// equal weights: mean of the two component percentiles
		const rationale = composite.get(1)?.rationale as Record<string, number>;
		expect(composite.get(1)?.score).toBeCloseTo(
			(rationale.insider_conviction_percentile + rationale.relative_value_percentile) / 2
		);
	});
});
