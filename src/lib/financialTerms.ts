export interface FinancialTerm {
	term: string;
	definition: string;
	clarification?: string;
}

export const FINANCIAL_TERMS = {
	germanIndices: {
		term: 'DAX / MDAX / SDAX',
		definition: 'Deutscher Aktienindex / Mid-Cap-DAX / Small-Cap-DAX',
		clarification: 'German equity indices covering large, mid-sized and smaller listed companies.'
	},
	surfaced: {
		term: 'Surfaced',
		definition: 'Assets with fired signals',
		clarification: 'An asset appears when at least one signal clears its materiality gate for the run.'
	},
	insiderConviction: {
		term: 'Insider Conviction',
		definition: 'Insider buying signal',
		clarification:
			'Clusters of disclosed director or related-party share purchases, adjusted for size, recency and sells.'
	},
	relativeValue: {
		term: 'Relative Value',
		definition: 'Valuation relative to peers',
		clarification: 'Here, a P/E discount versus the sector or index median, with basic quality gates.'
	},
	pe: {
		term: 'P/E',
		definition: 'Price-to-earnings ratio',
		clarification:
			'Share price divided by earnings per share; this app compares it with the peer-sector median.'
	},
	pb: {
		term: 'P/B',
		definition: 'Price-to-book ratio',
		clarification: 'Share price divided by book value per share; below 1 means the market values the company under its net assets.'
	},
	eps: {
		term: 'EPS',
		definition: 'Earnings per share'
	},
	ttm: {
		term: 'TTM',
		definition: 'Trailing twelve months'
	},
	marketCap: {
		term: 'Mkt cap',
		definition: 'Market capitalization',
		clarification: 'Share price multiplied by shares outstanding.'
	},
	filings: {
		term: 'Filings',
		definition: 'Regulatory filings',
		clarification: "Official disclosures such as directors' dealings and issuer notices."
	},
	insiderTrades: {
		term: 'Insider trades',
		definition: "Directors' dealings",
		clarification: 'Disclosed transactions by management, supervisory-board members or related parties.'
	},
	bafin: {
		term: 'BaFin',
		definition: 'Bundesanstalt fuer Finanzdienstleistungsaufsicht',
		clarification: "Germany's federal financial supervisory authority."
	},
	regulatoryNews: {
		term: 'Regulatory news',
		definition: 'Issuer regulatory announcements',
		clarification: 'Market-relevant company disclosures and exchange-published announcements.'
	}
} satisfies Record<string, FinancialTerm>;
