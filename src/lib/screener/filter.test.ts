import { describe, expect, it } from 'vitest';
import { matchesSearch } from './filter.js';
import type { CardData } from './types.js';

function card(overrides: Partial<CardData>): CardData {
	return {
		instrumentId: 1,
		isin: 'DE0007164600',
		wkn: '716460',
		name: 'SAP SE',
		sector: 'Software',
		rank: 1,
		price: null,
		priceDate: null,
		series: [],
		hi52: null,
		lo52: null,
		pe: null,
		peerMedianPe: null,
		peDeltaPct: null,
		eps: null,
		marketCap: null,
		insiders: [],
		news: [],
		...overrides
	};
}

describe('matchesSearch', () => {
	it('passes everything on an empty or whitespace query', () => {
		expect(matchesSearch(card({}), '')).toBe(true);
		expect(matchesSearch(card({}), '   ')).toBe(true);
	});

	it('matches name, ISIN and WKN case-insensitively', () => {
		expect(matchesSearch(card({}), 'sap')).toBe(true);
		expect(matchesSearch(card({}), 'de00071646')).toBe(true);
		expect(matchesSearch(card({}), '716460')).toBe(true);
		expect(matchesSearch(card({}), 'siemens')).toBe(false);
	});

	it('tolerates a null WKN', () => {
		// ISIN chosen so the WKN digits don't appear inside it.
		expect(matchesSearch(card({ isin: 'DE0007236101', wkn: null }), '716460')).toBe(false);
		expect(matchesSearch(card({ wkn: null }), 'sap')).toBe(true);
	});
});
