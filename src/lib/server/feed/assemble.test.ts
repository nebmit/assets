import { describe, expect, it } from 'vitest';
import { assembleCards, type PasserRow } from './assemble.js';
import { parseHeadline, parseMarketCap, parseReasons, parseRelativeValueRationale } from './rationale.js';

const passer: PasserRow = {
	instrumentId: 1,
	issuerId: 10,
	rank: 1,
	isin: 'DE0007164600',
	wkn: '716460',
	name: 'SAP SE',
	sector: 'Software',
	reasons: [{ signal: 'insider_conviction', severity: 0.4, headline: '2 insiders bought €1.2M in 30d' }],
	lifecycle: 'new'
};

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

describe('assembleCards', () => {
	it('merges all sources and derives the P/E delta', () => {
		const [card] = assembleCards(
			[passer],
			new Map([[1, { close: 245.8, eps: 5.84, pe: 42.1, pb: 5.2, peerMedianPe: 28.4 }]]),
			new Map([[1, 2.9e11]]),
			new Map([[1, [{ date: '2026-06-22', close: 240 }]]]),
			new Map([[1, { close: 245.8, tradeDate: '2026-07-01', hi52: 250, lo52: 180 }]]),
			new Map([[10, [{ partyName: 'J. White', partyRole: 'supervisory_board', side: 'buy', amount: 1_240_000, transactionDate: '2026-06-12' }]]]),
			new Map([[10, [{ headline: 'Raised guidance', newsType: 'Ad-hoc', publishedAt: '2026-06-27T15:00:00.000Z' }]]])
		);
		expect(card.rank).toBe(1);
		expect(card.reasons).toEqual(passer.reasons);
		expect(card.lifecycle).toBe('new');
		expect(card.price).toBe(245.8);
		expect(card.peDeltaPct).toBeCloseTo(48.24, 2);
		expect(card.pb).toBe(5.2);
		expect(card.marketCap).toBe(2.9e11);
		expect(card.insiders).toHaveLength(1);
		expect(card.news[0].newsType).toBe('Ad-hoc');
	});

	it('degrades missing side-data to nulls and empty lists', () => {
		const [card] = assembleCards(
			[passer],
			new Map(),
			new Map(),
			new Map(),
			new Map(),
			new Map(),
			new Map()
		);
		expect(card).toMatchObject({
			price: null,
			priceDate: null,
			series: [],
			hi52: null,
			pe: null,
			peDeltaPct: null,
			pb: null,
			eps: null,
			marketCap: null,
			insiders: [],
			news: []
		});
	});

	it('falls back to the rationale close when no price rows exist and guards a zero median', () => {
		const [card] = assembleCards(
			[passer],
			new Map([[1, { close: 245.8, eps: null, pe: 42.1, pb: null, peerMedianPe: 0 }]]),
			new Map(),
			new Map(),
			new Map(),
			new Map(),
			new Map()
		);
		expect(card.price).toBe(245.8);
		expect(card.peDeltaPct).toBeNull();
	});

	it('preserves passer order', () => {
		const second: PasserRow = { ...passer, instrumentId: 2, issuerId: 20, rank: 2, name: 'Siemens AG' };
		const cards = assembleCards(
			[passer, second],
			new Map(),
			new Map(),
			new Map(),
			new Map(),
			new Map(),
			new Map()
		);
		expect(cards.map((c) => c.name)).toEqual(['SAP SE', 'Siemens AG']);
	});
});
