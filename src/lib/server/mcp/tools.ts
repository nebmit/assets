import { baseScreens, compositeMeta } from '../signals/engine.js';

export interface ScreenToolMeta {
	slug: string;
	name: string;
	description: string;
}

/** LLM-facing descriptions; a screen missing here falls back to its display name. */
const descriptions: Record<string, string> = {
	insider_conviction:
		'Insider Conviction screen over German equities (DAX/MDAX/SDAX): net insider share buying ' +
		'(BaFin Art. 19 MAR dealings) in the recent window, scored by size relative to market cap, ' +
		'buyer clustering, seniority and recency. Gate: strictly positive net buying. Returns the ' +
		'ranked gate-passers of a signal run, strongest first, with per-row rationale.',
	relative_value:
		'Relative Value screen over German equities (DAX/MDAX/SDAX): P/E from the latest close and ' +
		'point-in-time EPS versus the sector-peer median (index median when too few sector peers). ' +
		'Gate: positive earnings and a fresh, sane P/E. Score: relative discount to the peer median ' +
		'— cheaper than peers ranks higher. Returns the ranked gate-passers of a signal run.',
	[compositeMeta.slug]:
		'Value × Insider Composite screen over German equities (DAX/MDAX/SDAX): equal-weighted mean ' +
		'of the insider_conviction and relative_value percentiles; only instruments passing both ' +
		'component gates qualify. This is the headline screen shown on the screener page. Returns ' +
		'the ranked gate-passers of a signal run.'
};

/** One MCP tool per screen, derived from the engine registry. */
export const screenTools: ScreenToolMeta[] = [...baseScreens, compositeMeta].map((def) => ({
	slug: def.slug,
	name: def.name,
	description: descriptions[def.slug] ?? def.name
}));
