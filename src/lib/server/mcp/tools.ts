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
	[surfacedMeta.slug]:
		'The surfaced-assets feed over German equities (DAX/MDAX/SDAX) — the headline output. An ' +
		'asset appears when at least one signal fires past an absolute materiality floor (insider ' +
		'buying cluster, material valuation discount); additional fired signals raise the combined ' +
		'severity (noisy-or) but are never required. Scores are calibrated severities in [0,1], ' +
		'comparable across days: ~0.2 barely material, ~0.5 strong, ~1 exceptional. An empty result ' +
		'is meaningful — nothing interesting happened. Each row carries `reasons` (per-signal ' +
		'headline + severity) in its rationale. We surface, we never recommend.',
	insider_conviction:
		'Insider Conviction signal over German equities (DAX/MDAX/SDAX): role-weighted, ' +
		'publication-decayed insider share *buying* (BaFin Art. 19 MAR dealings) in the last 30 ' +
		'days. Gate: an absolute cap-band-aware materiality floor (€100k DAX / €50k MDAX / €25k ' +
		'SDAX role-weighted, halved for ≥2-buyer clusters) — token buys never surface. Sells only ' +
		'dampen, never erase, buys. Severity in [0,1] rises with size vs floor, buyer clustering ' +
		'and buying into a falling price. Returns fired signals of a run, strongest first.',
	relative_value:
		'Relative Value signal over German equities (DAX/MDAX/SDAX): P/E from the latest close and ' +
		'point-in-time EPS versus the super-sector peer median (index median when too few peers). ' +
		'Gate: a *material* discount (≥15%) with fresh prices, positive earnings and no falling ' +
		'knife (>35% six-month drop is gated out, not surfaced). Severity in [0,1] deepens with ' +
		'the discount plus a small dividend-yield support bonus. Returns fired signals of a run.'
};

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
