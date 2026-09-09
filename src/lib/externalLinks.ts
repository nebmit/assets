export const FILINGS_SEARCH_URL = 'https://www.unternehmensregister.de/de/suche/rechnungslegung';

export function bafinDealingsUrl(isin: string): string {
	const params = new URLSearchParams({
		zeitraum: '0',
		emittentIsin: isin,
		emittentButton: 'Suche Emittent'
	});
	return `https://portal.mvp.bafin.de/database/DealingsInfo/sucheForm.do?${params.toString()}`;
}

/**
 * Deeplink into Claude's Customize > Connectors "Add custom connector" flow with this server's remote
 * MCP endpoint prefilled. `modal=add-custom-connector` opens the dialog; the
 * `mcpName`/`mcpServerUrl` params prefill the fields where supported, and the
 * modal opens regardless so the user can paste the URL as a fallback.
 */
export function claudeConnectorUrl(mcpUrl: string, name = 'assets'): string {
	const params = new URLSearchParams({
		modal: 'add-custom-connector',
		mcpName: name,
		mcpServerUrl: mcpUrl
	});
	return `https://claude.ai/customize/connectors?${params.toString()}`;
}

export interface AssetLinks { quote: string | null; filings: string | null; insiders: string | null }
export function assetLinks(asset: { isin: string | null; cik: string | null; ticker: string | null; source: string }): AssetLinks {
	if (asset.source === 'alpaca' || asset.source === 'sec' || asset.cik) {
		const filings = asset.cik ? `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(asset.cik)}` : 'https://www.sec.gov/edgar/search/';
		return { quote: asset.ticker ? `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(asset.ticker.toLowerCase())}` : null, filings, insiders: `${filings}&owner=only` };
	}
	return { quote: asset.isin ? `https://www.boerse-frankfurt.de/equity/${asset.isin.toLowerCase()}` : null, filings: FILINGS_SEARCH_URL, insiders: asset.isin ? bafinDealingsUrl(asset.isin) : null };
}
