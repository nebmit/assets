import { signalDefinitions, surfacedMeta } from '../signals/engine.js';

export interface SignalToolMeta {
	slug: string;
	name: string;
	/** MCP tool name; the feed gets a product name, facets get signal_<slug>. */
	toolName: string;
	description: string;
}

/** LLM-facing descriptions; a signal missing here falls back to its display name. */
const descriptions: Record<string, string> = {
	no_disclosed_shorts: 'No Disclosed Shorts: confirmation over fresh, complete Bundesanzeiger open-register snapshots. ' +
		'No publicly disclosed positions at or above 0.5% per holder contributes 0.10 via noisy-or only when a discovery signal fires. ' +
		'Absence alone never surfaces an asset; presence adds no penalty. Smaller undisclosed positions may exist. ' +
		'Historical dates before snapshot coverage are unknown. Rows include holder details, disclosed totals and freshness.',
	[surfacedMeta.slug]:
		'The surfaced-assets feed over equities in the combined universe — the headline output. An ' +
		'asset appears when at least one signal fires past an absolute materiality floor (insider ' +
		'buying cluster, material valuation discount); additional fired signals raise the combined ' +
		'severity (noisy-or) but are never required. Fresh confirmed absence of disclosed short positions adds a 0.10 confirmation; it never surfaces an asset alone. Scores are calibrated severities in [0,1], ' +
		'comparable across days: ~0.2 barely material, ~0.5 strong, ~1 exceptional. An empty result ' +
		'means no qualified evidence cleared a gate; coverage explains unavailable inputs. Each row carries insiders with ' +
		'roles, dates and prices, a point-in-time fundamentals snapshot, every signal’s severity ' +
		'sub-components, public short seller analysis, recent news headlines and a sector-concentration count — use `issuer_detail` ' +
		'for price/EPS history and insider follow-through. We surface, we never recommend.',
	insider_conviction:
		'Insider Conviction signal over equities in the combined universe: role-weighted, ' +
		'publication-decayed insider share *buying* (normalized regulatory filings) in the last 30 ' +
		'days. Gate: an absolute cap-band-aware materiality floor (€100k large / €50k mid / €25k ' +
		'small role-weighted, halved for ≥2-buyer clusters) — token buys never surface. Sells only ' +
		'dampen, never erase, buys. Severity in [0,1] rises with size vs floor, buyer clustering ' +
		'and buying into a falling price. Returns fired signals of a run, strongest first. Rows ' +
		'include per-insider detail (name, role, role weight, dates, prices, dealing type at the ' +
		'source-supported granularity, including explicit or inferred native currency) and the severity sub-components as filterable fields.',
	relative_value:
		'Relative Value signal over equities in the combined universe: P/E from the latest close and ' +
		'point-in-time EPS versus the super-sector peer median (shared size-band median when too few issuers). ' +
		'Gate: a *material* discount (≥15%) with fresh prices, positive earnings and no falling ' +
		'knife (>35% six-month drop is gated out, not surfaced). Severity in [0,1] deepens with ' +
		'the discount plus a small dividend-yield support bonus. Returns fired signals of a run. ' +
		'Rows include the fundamentals snapshot and the valuation sub-components (P/E, peer median, ' +
		'discount, peer group) as filterable fields.'
};

/** LLM-facing description of the per-issuer drill-down tool. */
export const ISSUER_DETAIL_DESCRIPTION =
	'Historical drill-down for one instrument by assetId: ~36 months of monthly closes, EPS / market-cap ' +
	'/ dividend history (the shape separates "earnings genuinely recovered" from "the multiple ' +
	'deflated"), the stored insider transaction record with per-insider follow-through (has this ' +
	'person bought before, and what was the split-adjusted native-currency price return?), public short seller analysis from the signal run, and recent headlines. All data is ' +
	'bounded by the run date (no lookahead) and reaches back only as far as ingestion does: prices ' +
	'~3 years; dealings and qualified metric histories accumulate as observed. Works for any ' +
	'universe instrument, surfaced or not.';

/** Appended to every tool: results are personalized by the account's ignore list. */
const IGNORE_LIST_NOTE =
	' Assets on the ignore list of the calling account (managed in the web app) are excluded from ' +
	'results and counts.';

/** One MCP tool per signal, derived from the engine registry. */
export const signalTools: SignalToolMeta[] = [surfacedMeta, ...signalDefinitions].map((def) => ({
	slug: def.slug,
	name: def.name,
	toolName: def.slug === surfacedMeta.slug ? 'surface_latest' : `signal_${def.slug}`,
	description: (descriptions[def.slug] ?? def.name) + IGNORE_LIST_NOTE
}));
