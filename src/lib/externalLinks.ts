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
