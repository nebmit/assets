export const FILINGS_SEARCH_URL = 'https://www.unternehmensregister.de/de/suche/rechnungslegung';

export function bafinDealingsUrl(isin: string): string {
	const params = new URLSearchParams({
		zeitraum: '0',
		emittentIsin: isin,
		emittentButton: 'Suche Emittent'
	});
	return `https://portal.mvp.bafin.de/database/DealingsInfo/sucheForm.do?${params.toString()}`;
}
