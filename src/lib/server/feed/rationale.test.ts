import { describe, expect, it } from 'vitest';
import { parseInsiderComponents, parseRelativeValueComponents } from './rationale.js';

describe('parseInsiderComponents', () => {
	it('reads a full v3 rationale', () => {
		const view = parseInsiderComponents({
			size_score: 0.4,
			cluster_factor: 1.5,
			sell_dampen: 1,
			contrarian_boost: 1.2,
			buyer_count: 3,
			buy_value_eur: 250_000,
			sell_value_eur: 0,
			weighted_buy_eur: 231_000,
			floor_eur: 100_000,
			passes_size_gate: true,
			passes_cluster_gate: true,
			bought_into_decline: false
		});
		expect(view).toEqual({
			sizeScore: 0.4,
			clusterFactor: 1.5,
			sellDampen: 1,
			contrarianBoost: 1.2,
			buyerCount: 3,
			buyValueEur: 250_000,
			sellValueEur: 0,
			weightedBuyEur: 231_000,
			floorEur: 100_000,
			passesSizeGate: true,
			passesClusterGate: true,
			boughtIntoDecline: false
		});
	});

	it('degrades pre-v3 rows to nulls for the fields they lack', () => {
		const view = parseInsiderComponents({
			size_score: 0.4,
			buy_value_eur: 250_000
		});
		expect(view.sizeScore).toBe(0.4);
		expect(view.buyValueEur).toBe(250_000);
		expect(view.passesSizeGate).toBeNull();
		expect(view.passesClusterGate).toBeNull();
		expect(view.boughtIntoDecline).toBeNull();
	});

	it('never throws on garbage', () => {
		expect(parseInsiderComponents('not an object').sizeScore).toBeNull();
		expect(parseInsiderComponents(null).buyerCount).toBeNull();
		expect(parseInsiderComponents({ size_score: 'high', passes_size_gate: 1 })).toMatchObject({
			sizeScore: null,
			passesSizeGate: null
		});
	});
});

describe('parseRelativeValueComponents', () => {
	it('reads peer fields when present', () => {
		const view = parseRelativeValueComponents({
			pe: 8.2,
			peer_median_pe: 14.1,
			peer_count: 9,
			peer_group: 'sector:Financials',
			discount_to_peer_median: 0.42,
			dividend_yield: 0.05,
			knife_guard: true
		});
		expect(view).toEqual({
			pe: 8.2,
			peerMedianPe: 14.1,
			peerCount: 9,
			peerGroup: 'sector:Financials',
			discountToPeerMedian: 0.42,
			dividendYield: 0.05,
			knifeGuard: true
		});
	});

	it('degrades rows without a peer comparison to nulls', () => {
		const view = parseRelativeValueComponents({ pe: 8.2 });
		expect(view.pe).toBe(8.2);
		expect(view.peerMedianPe).toBeNull();
		expect(view.discountToPeerMedian).toBeNull();
		expect(view.knifeGuard).toBeNull();
	});

	it('never throws on garbage', () => {
		expect(parseRelativeValueComponents([1, 2, 3]).pe).toBeNull();
		expect(parseRelativeValueComponents({ peer_group: 42 }).peerGroup).toBeNull();
	});
});

import { parseHeadline, parseMarketCap, parseReasons, parseRelativeValueRationale } from './rationale.js';

describe('parseRelativeValueRationale', () => {
	it('reads the engine shape', () => {
		expect(
			parseRelativeValueRationale({
				close: 245.8,
				close_date: '2026-07-01',
				eps_basic: 5.84,
				pe: 42.1,
				price_book: 5.2,
				peer_group: 'Software',
				peer_median_pe: 28.4
			})
		).toEqual({ close: 245.8, eps: 5.84, pe: 42.1, pb: 5.2, peerMedianPe: 28.4 });
	});

	it('degrades malformed or partial rationale to nulls, never throws', () => {
		expect(parseRelativeValueRationale(null)).toEqual({
			close: null,
			eps: null,
			pe: null,
			pb: null,
			peerMedianPe: null
		});
		expect(parseRelativeValueRationale({ pe: 'not a number', close: 12 })).toEqual({
			close: 12,
			eps: null,
			pe: null,
			pb: null,
			peerMedianPe: null
		});
		expect(parseRelativeValueRationale('garbage')).toEqual({
			close: null,
			eps: null,
			pe: null,
			pb: null,
			peerMedianPe: null
		});
	});
});

describe('parseMarketCap', () => {
	it('reads market_cap and tolerates junk', () => {
		expect(parseMarketCap({ market_cap: 2.9e11, buy_value_eur: 5 })).toBe(2.9e11);
		expect(parseMarketCap({ market_cap: 'n/a' })).toBeNull();
		expect(parseMarketCap(undefined)).toBeNull();
	});
});

describe('parseReasons / parseHeadline', () => {
	it('reads the surfaced-feed reasons list', () => {
		expect(
			parseReasons({
				reasons: [{ signal: 'relative_value', severity: 0.3, headline: 'P/E 6.1, 40% below Financials median' }],
				event_date: null
			})
		).toEqual([{ signal: 'relative_value', severity: 0.3, headline: 'P/E 6.1, 40% below Financials median' }]);
	});

	it('degrades malformed reasons and headlines instead of throwing', () => {
		expect(parseReasons({ reasons: 'garbage' })).toEqual([]);
		expect(parseReasons(null)).toEqual([]);
		expect(parseHeadline({ headline: '1 insider bought €400k in 30d' })).toBe('1 insider bought €400k in 30d');
		expect(parseHeadline({ headline: 42 })).toBe('');
		expect(parseHeadline(undefined)).toBe('');
	});
});
