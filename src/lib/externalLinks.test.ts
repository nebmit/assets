import { describe, expect, it } from 'vitest';
import { bafinDealingsUrl, claudeConnectorUrl, FILINGS_SEARCH_URL } from './externalLinks.js';

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

	it('builds a Claude add-custom-connector deeplink', () => {
		expect(claudeConnectorUrl()).toBe(
			'https://claude.ai/customize/connectors?modal=add-custom-connector'
		);
	});

	it('does not include unsupported Claude connector prefill params', () => {
		const url = claudeConnectorUrl();
		expect(url).not.toContain('mcpName=');
		expect(url).not.toContain('mcpServerUrl=');
	});
});
