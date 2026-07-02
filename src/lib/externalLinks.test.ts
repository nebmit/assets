import { describe, expect, it } from 'vitest';
import { bafinDealingsUrl, FILINGS_SEARCH_URL } from './externalLinks.js';

describe('external links', () => {
	it('builds a BaFin DealingsInfo issuer search URL for an ISIN', () => {
		expect(bafinDealingsUrl('DE0007164600')).toBe(
			'https://portal.mvp.bafin.de/database/DealingsInfo/sucheForm.do?zeitraum=0&emittentIsin=DE0007164600&emittentButton=Suche+Emittent'
		);
	});

	it('encodes BaFin query parameters', () => {
		expect(bafinDealingsUrl('DE0007164600+test')).toContain('emittentIsin=DE0007164600%2Btest');
	});

	it('points filings at the official financial reports search', () => {
		expect(FILINGS_SEARCH_URL).toBe('https://www.unternehmensregister.de/de/suche/rechnungslegung');
	});
});
