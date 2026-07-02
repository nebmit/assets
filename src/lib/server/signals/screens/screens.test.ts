import { describe, expect, it } from 'vitest';
import type { InsiderTx, UniverseContext, UniverseInstrument } from '../types.js';
import { insiderConvictionScreen } from './insiderConviction.js';
import { relativeValueScreen } from './relativeValue.js';

const RUN_DATE = '2026-07-02';

function makeInstrument(overrides: Partial<UniverseInstrument> & { instrumentId: number }): UniverseInstrument {
	return {
		issuerId: overrides.instrumentId,
		isin: `DE${String(overrides.instrumentId).padStart(10, '0')}`,
		ticker: `T${overrides.instrumentId}`,
		name: `Company ${overrides.instrumentId}`,
		sector: 'Industrial',
		indexName: 'DAX',
		close: 100,
		closeDate: RUN_DATE,
		epsBasic: 10,
		marketCap: 1e9,
		insiderTx: [],
		...overrides
	};
}

function makeTx(overrides: Partial<InsiderTx>): InsiderTx {
	return {
		partyName: 'Buyer',
		partyRole: 'executive_board',
		side: 'buy',
		instrumentType: 'Aktie',
		amount: 100_000,
		transactionDate: '2026-06-30',
		publishedDate: '2026-07-01',
		...overrides
	};
}

function ctxOf(instruments: UniverseInstrument[]): UniverseContext {
	return { runDate: RUN_DATE, instruments };
}

describe('insiderConvictionScreen', () => {
	it('gates out net sellers and instruments without buys', () => {
		const seller = makeInstrument({
			instrumentId: 1,
			insiderTx: [makeTx({ side: 'sell', amount: 200_000 }), makeTx({ amount: 100_000 })]
		});
		const quiet = makeInstrument({ instrumentId: 2 });
		const ctx = ctxOf([seller, quiet]);
		expect(insiderConvictionScreen.evaluate(seller, ctx).passedGate).toBe(false);
		expect(insiderConvictionScreen.evaluate(quiet, ctx).passedGate).toBe(false);
	});

	it('ignores non-share dealings and side "other"', () => {
		const inst = makeInstrument({
			instrumentId: 1,
			insiderTx: [
				makeTx({ instrumentType: 'Derivat' }),
				makeTx({ side: 'other' }),
				makeTx({ amount: null })
			]
		});
		expect(insiderConvictionScreen.evaluate(inst, ctxOf([inst])).passedGate).toBe(false);
	});

	it('scores recent buys higher than old ones (recency decay)', () => {
		const recent = makeInstrument({
			instrumentId: 1,
			insiderTx: [makeTx({ transactionDate: '2026-07-01' })]
		});
		const old = makeInstrument({
			instrumentId: 2,
			insiderTx: [makeTx({ transactionDate: '2026-06-04' })]
		});
		const ctx = ctxOf([recent, old]);
		const recentScore = insiderConvictionScreen.evaluate(recent, ctx).score as number;
		const oldScore = insiderConvictionScreen.evaluate(old, ctx).score as number;
		expect(recentScore).toBeGreaterThan(oldScore);
		// two half-lives (28 days) ≈ quarter of the weight
		expect(oldScore).toBeLessThan(recentScore / 3);
	});

	it('weights executive buys over related-party buys and rewards clusters', () => {
		const exec = makeInstrument({ instrumentId: 1, insiderTx: [makeTx({})] });
		const related = makeInstrument({
			instrumentId: 2,
			insiderTx: [makeTx({ partyRole: 'related_party' })]
		});
		const cluster = makeInstrument({
			instrumentId: 3,
			insiderTx: [
				makeTx({ partyName: 'A', amount: 50_000 }),
				makeTx({ partyName: 'B', amount: 50_000 })
			]
		});
		const ctx = ctxOf([exec, related, cluster]);
		const execScore = insiderConvictionScreen.evaluate(exec, ctx).score as number;
		const relatedScore = insiderConvictionScreen.evaluate(related, ctx).score as number;
		const clusterScore = insiderConvictionScreen.evaluate(cluster, ctx).score as number;
		expect(execScore).toBeGreaterThan(relatedScore);
		expect(clusterScore).toBeGreaterThan(execScore);
	});

	it('normalizes by market cap (same buy matters more in a small cap)', () => {
		const small = makeInstrument({ instrumentId: 1, marketCap: 1e8, insiderTx: [makeTx({})] });
		const large = makeInstrument({ instrumentId: 2, marketCap: 1e11, insiderTx: [makeTx({})] });
		const ctx = ctxOf([small, large]);
		expect(insiderConvictionScreen.evaluate(small, ctx).score as number).toBeGreaterThan(
			insiderConvictionScreen.evaluate(large, ctx).score as number
		);
	});
});

describe('relativeValueScreen', () => {
	it('gates out negative earnings, extreme P/E and stale prices', () => {
		const negative = makeInstrument({ instrumentId: 1, epsBasic: -2 });
		const extreme = makeInstrument({ instrumentId: 2, epsBasic: 0.01 }); // P/E 10000
		const stale = makeInstrument({ instrumentId: 3, closeDate: '2026-05-01' });
		const ctx = ctxOf([negative, extreme, stale]);
		for (const inst of [negative, extreme, stale]) {
			expect(relativeValueScreen.evaluate(inst, ctx).passedGate).toBe(false);
		}
	});

	it('uses the sector median with >=5 peers and scores discounts higher', () => {
		// six Industrial peers: P/E 5 (cheap) and five at P/E 20
		const cheap = makeInstrument({ instrumentId: 1, close: 50 });
		const peers = [2, 3, 4, 5, 6].map((id) => makeInstrument({ instrumentId: id, close: 200 }));
		const ctx = ctxOf([cheap, ...peers]);
		const result = relativeValueScreen.evaluate(cheap, ctx);
		expect(result.passedGate).toBe(true);
		expect(result.rationale.peer_group).toBe('sector:Industrial');
		expect(result.rationale.peer_median_pe).toBe(20);
		expect(result.score).toBeCloseTo((20 - 5) / 20);
	});

	it('falls back to the index median when the sector is too small', () => {
		const inst = makeInstrument({ instrumentId: 1, sector: 'Software' });
		const daxPeers = [2, 3].map((id) => makeInstrument({ instrumentId: id, sector: 'Industrial' }));
		const ctx = ctxOf([inst, ...daxPeers]);
		expect(relativeValueScreen.evaluate(inst, ctx).rationale.peer_group).toBe('index:DAX');
	});
});
