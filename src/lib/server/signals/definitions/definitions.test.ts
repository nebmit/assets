import { describe, expect, it } from 'vitest';
import { superSector } from '../sectors.js';
import type { InsiderTx, UniverseContext, UniverseInstrument } from '../types.js';
import { insiderConvictionSignal, publicationDecay } from './insiderConviction.js';
import { relativeValueSignal } from './relativeValue.js';

const RUN_DATE = '2026-07-02';

function makeInstrument(overrides: Partial<UniverseInstrument> & { instrumentId: number }): UniverseInstrument {
	return {
		issuerId: overrides.instrumentId,
		isin: `DE${String(overrides.instrumentId).padStart(10, '0')}`,
		ticker: `T${overrides.instrumentId}`,
		name: `Company ${overrides.instrumentId}`,
		sector: 'Industrial products',
		indexName: 'DAX',
		close: 100,
		closeDate: RUN_DATE,
		epsBasic: 10,
		marketCap: 1e9,
		dividendPerShare: null,
		return3m: null,
		return6m: null,
		drawdown52w: null,
		above52wLow: null,
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
		amount: 400_000,
		transactionDate: '2026-06-30',
		publishedDate: '2026-07-01',
		...overrides
	};
}

function ctxOf(instruments: UniverseInstrument[]): UniverseContext {
	return { runDate: RUN_DATE, instruments };
}

describe('insiderConvictionSignal', () => {
	it('gates out token buys below the materiality floor', () => {
		// €5k courtesy buy at a DAX name (floor €100k) must not surface
		const token = makeInstrument({ instrumentId: 1, insiderTx: [makeTx({ amount: 5_000 })] });
		const quiet = makeInstrument({ instrumentId: 2 });
		const ctx = ctxOf([token, quiet]);
		expect(insiderConvictionSignal.evaluate(token, ctx).passedGate).toBe(false);
		expect(insiderConvictionSignal.evaluate(quiet, ctx).passedGate).toBe(false);
	});

	it('scales the floor by cap band: the same buy matters more in the SDAX', () => {
		const buy = makeTx({ amount: 40_000 });
		const dax = makeInstrument({ instrumentId: 1, indexName: 'DAX', insiderTx: [buy] });
		const sdax = makeInstrument({ instrumentId: 2, indexName: 'SDAX', insiderTx: [buy] });
		const ctx = ctxOf([dax, sdax]);
		expect(insiderConvictionSignal.evaluate(dax, ctx).passedGate).toBe(false);
		expect(insiderConvictionSignal.evaluate(sdax, ctx).passedGate).toBe(true);
	});

	it('lets a ≥2-buyer cluster qualify at half the floor', () => {
		const solo = makeInstrument({ instrumentId: 1, insiderTx: [makeTx({ amount: 60_000 })] });
		const cluster = makeInstrument({
			instrumentId: 2,
			insiderTx: [
				makeTx({ partyName: 'A', amount: 30_000 }),
				makeTx({ partyName: 'B', amount: 30_000 })
			]
		});
		const ctx = ctxOf([solo, cluster]);
		expect(insiderConvictionSignal.evaluate(solo, ctx).passedGate).toBe(false);
		expect(insiderConvictionSignal.evaluate(cluster, ctx).passedGate).toBe(true);
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
		expect(insiderConvictionSignal.evaluate(inst, ctxOf([inst])).passedGate).toBe(false);
	});

	it('dampens but never erases buys with a large sell (netting destroyed the signal)', () => {
		const buysOnly = makeInstrument({ instrumentId: 1, insiderTx: [makeTx({})] });
		const buysAndBigSell = makeInstrument({
			instrumentId: 2,
			insiderTx: [makeTx({}), makeTx({ partyName: 'Seller', side: 'sell', amount: 2_000_000 })]
		});
		const ctx = ctxOf([buysOnly, buysAndBigSell]);
		const clean = insiderConvictionSignal.evaluate(buysOnly, ctx);
		const dampened = insiderConvictionSignal.evaluate(buysAndBigSell, ctx);
		expect(dampened.passedGate).toBe(true); // v1 netting would have gated this out
		expect(dampened.score as number).toBeLessThan(clean.score as number);
		expect(dampened.score as number).toBeGreaterThan(0);
	});

	it('decays by publication recency: fresh filings score higher', () => {
		const fresh = makeInstrument({ instrumentId: 1, insiderTx: [makeTx({ publishedDate: '2026-07-01' })] });
		const old = makeInstrument({
			instrumentId: 2,
			insiderTx: [makeTx({ transactionDate: '2026-06-04', publishedDate: '2026-06-05' })]
		});
		const ctx = ctxOf([fresh, old]);
		const freshResult = insiderConvictionSignal.evaluate(fresh, ctx);
		const oldResult = insiderConvictionSignal.evaluate(old, ctx);
		expect(freshResult.score as number).toBeGreaterThan(oldResult.score as number);
		expect(freshResult.eventDate).toBe('2026-07-01');
	});

	it('boosts buying into a falling price (contrarian conditioning)', () => {
		const intoWeakness = makeInstrument({ instrumentId: 1, return3m: -0.3, insiderTx: [makeTx({})] });
		const intoStrength = makeInstrument({ instrumentId: 2, return3m: 0.3, insiderTx: [makeTx({})] });
		const ctx = ctxOf([intoWeakness, intoStrength]);
		expect(insiderConvictionSignal.evaluate(intoWeakness, ctx).score as number).toBeGreaterThan(
			insiderConvictionSignal.evaluate(intoStrength, ctx).score as number
		);
	});

	it('rewards clusters over solo buys of the same total size', () => {
		const solo = makeInstrument({ instrumentId: 1, insiderTx: [makeTx({ amount: 300_000 })] });
		const cluster = makeInstrument({
			instrumentId: 2,
			insiderTx: [
				makeTx({ partyName: 'A', amount: 150_000 }),
				makeTx({ partyName: 'B', amount: 150_000 })
			]
		});
		const ctx = ctxOf([solo, cluster]);
		expect(insiderConvictionSignal.evaluate(cluster, ctx).score as number).toBeGreaterThan(
			insiderConvictionSignal.evaluate(solo, ctx).score as number
		);
	});

	it('exposes which gate passed and buying-into-decline in the rationale', () => {
		const soloSize = makeInstrument({
			instrumentId: 1,
			return3m: -0.2,
			insiderTx: [makeTx({ amount: 400_000 })]
		});
		const clusterOnly = makeInstrument({
			instrumentId: 2,
			return3m: 0.05,
			insiderTx: [
				makeTx({ partyName: 'A', amount: 30_000 }),
				makeTx({ partyName: 'B', amount: 30_000 })
			]
		});
		const gatedOut = makeInstrument({ instrumentId: 3, return3m: -0.5, insiderTx: [makeTx({ amount: 5_000 })] });
		const ctx = ctxOf([soloSize, clusterOnly, gatedOut]);

		expect(insiderConvictionSignal.evaluate(soloSize, ctx).rationale).toMatchObject({
			passes_size_gate: true,
			bought_into_decline: true
		});
		expect(insiderConvictionSignal.evaluate(clusterOnly, ctx).rationale).toMatchObject({
			passes_size_gate: false,
			passes_cluster_gate: true,
			bought_into_decline: false
		});
		// gate flags are persisted for non-passers too, so query-time readers see them
		expect(insiderConvictionSignal.evaluate(gatedOut, ctx).rationale).toMatchObject({
			passes_size_gate: false,
			passes_cluster_gate: false,
			bought_into_decline: true
		});
	});

	it('decays publication weight with a 21-day half-life', () => {
		expect(publicationDecay(RUN_DATE, RUN_DATE)).toBe(1);
		expect(publicationDecay('2026-06-11', RUN_DATE)).toBeCloseTo(0.5); // 21 days earlier
		// future publication dates (bad data) never inflate the weight
		expect(publicationDecay('2026-07-10', RUN_DATE)).toBe(1);
	});
});

describe('relativeValueSignal', () => {
	it('gates out negative earnings, extreme P/E and stale prices', () => {
		const negative = makeInstrument({ instrumentId: 1, epsBasic: -2 });
		const extreme = makeInstrument({ instrumentId: 2, epsBasic: 0.01 }); // P/E 10000
		const stale = makeInstrument({ instrumentId: 3, closeDate: '2026-05-01' });
		const ctx = ctxOf([negative, extreme, stale]);
		for (const inst of [negative, extreme, stale]) {
			expect(relativeValueSignal.evaluate(inst, ctx).passedGate).toBe(false);
		}
	});

	it('requires a material discount — merely rankable is not cheap', () => {
		// P/E 18 vs median 20 = 10% discount: valid, but not material
		const slightly = makeInstrument({ instrumentId: 1, close: 180 });
		const peers = [2, 3, 4, 5, 6].map((id) => makeInstrument({ instrumentId: id, close: 200 }));
		const ctx = ctxOf([slightly, ...peers]);
		const result = relativeValueSignal.evaluate(slightly, ctx);
		expect(result.passedGate).toBe(false);
		expect(result.rationale.discount_to_peer_median as number).toBeCloseTo(0.1);
	});

	it('uses the super-sector median with >=5 peers and deepens severity with the discount', () => {
		const cheap = makeInstrument({ instrumentId: 1, close: 50 }); // P/E 5 vs 20
		const moderate = makeInstrument({ instrumentId: 7, close: 150 }); // P/E 15 vs 20
		const peers = [2, 3, 4, 5, 6].map((id) => makeInstrument({ instrumentId: id, close: 200 }));
		const ctx = ctxOf([cheap, moderate, ...peers]);
		const deep = relativeValueSignal.evaluate(cheap, ctx);
		const shallow = relativeValueSignal.evaluate(moderate, ctx);
		expect(deep.passedGate).toBe(true);
		expect(deep.rationale.peer_group).toBe('sector:Industrials');
		expect(deep.rationale.peer_median_pe).toBe(20);
		expect(shallow.passedGate).toBe(true);
		expect(deep.score as number).toBeGreaterThan(shallow.score as number);
	});

	it('gates out falling knives even when they look cheap', () => {
		const knife = makeInstrument({ instrumentId: 1, close: 50, return6m: -0.5 });
		const peers = [2, 3, 4, 5, 6].map((id) => makeInstrument({ instrumentId: id, close: 200 }));
		const result = relativeValueSignal.evaluate(knife, ctxOf([knife, ...peers]));
		expect(result.passedGate).toBe(false);
		expect(result.rationale.knife_guard).toBe(true);
	});

	it('adds a dividend-yield support bonus', () => {
		const plain = makeInstrument({ instrumentId: 1, close: 50 });
		const payer = makeInstrument({ instrumentId: 7, close: 50, dividendPerShare: 2.5 }); // 5% yield
		const peers = [2, 3, 4, 5, 6].map((id) => makeInstrument({ instrumentId: id, close: 200 }));
		const ctx = ctxOf([plain, payer, ...peers]);
		expect(relativeValueSignal.evaluate(payer, ctx).score as number).toBeGreaterThan(
			relativeValueSignal.evaluate(plain, ctx).score as number
		);
	});

	it('falls back to the index median when the super-sector is too small', () => {
		const inst = makeInstrument({ instrumentId: 1, sector: 'Software', close: 50 });
		const daxPeers = [2, 3].map((id) => makeInstrument({ instrumentId: id, sector: 'Industrial products' }));
		const ctx = ctxOf([inst, ...daxPeers]);
		expect(relativeValueSignal.evaluate(inst, ctx).rationale.peer_group).toBe('index:DAX');
	});
});

describe('superSector', () => {
	it('maps BF free-text sectors into coarse buckets', () => {
		expect(superSector('Banks')).toBe('Financials');
		expect(superSector('Real Estate')).toBe('Real Estate');
		expect(superSector('Software')).toBe('Technology');
		expect(superSector('Semiconductors')).toBe('Technology');
		expect(superSector('Automobile Manufacturers')).toBe('Industrials');
		expect(superSector('Defence')).toBe('Industrials');
		expect(superSector('Chemicals')).toBe('Materials');
		expect(superSector('Telecommunication')).toBe('Communications');
		expect(superSector('Retail, Internet')).toBe('Technology'); // first matching rule wins
		expect(superSector(null)).toBeNull();
		expect(superSector('Something Unmapped')).toBeNull();
	});
});
