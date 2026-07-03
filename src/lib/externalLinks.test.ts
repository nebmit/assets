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

	it('builds a Claude add-custom-connector deeplink with the MCP URL prefilled', () => {
		expect(claudeConnectorUrl('https://assets.timben.net/mcp')).toBe(
			'https://claude.ai/customize/connectors?modal=add-custom-connector&mcpName=assets&mcpServerUrl=https%3A%2F%2Fassets.timben.net%2Fmcp'
		);
	});

	it('encodes the MCP URL and a custom connector name', () => {
		const url = claudeConnectorUrl('http://localhost:5173/mcp?x=1', 'my assets');
		expect(url).toContain('mcpName=my+assets');
		expect(url).toContain('mcpServerUrl=http%3A%2F%2Flocalhost%3A5173%2Fmcp%3Fx%3D1');
	});
});
