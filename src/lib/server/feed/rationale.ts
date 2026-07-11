import { z } from 'zod';

/**
 * Tolerant readers for signal rationale JSONB. Rationale shapes are owned by
 * the signal definitions, but rows may come from older engine versions or be
 * partially populated (e.g. peer fields only exist for relative-value gate
 * passers) — so every field degrades to null instead of throwing.
 */

const numberOrNull = z.number().finite().nullable().catch(null);
const booleanOrNull = z.boolean().nullable().catch(null);
const stringOrNull = z.string().nullable().catch(null);

const relativeValueRationale = z.object({
	close: numberOrNull.default(null),
	eps_basic: numberOrNull.default(null),
	pe: numberOrNull.default(null),
	price_book: numberOrNull.default(null),
	peer_median_pe: numberOrNull.default(null)
});

export interface RelativeValueView {
	close: number | null;
	eps: number | null;
	pe: number | null;
	pb: number | null;
	peerMedianPe: number | null;
}

export function parseRelativeValueRationale(raw: unknown): RelativeValueView {
	const parsed = relativeValueRationale.safeParse(raw ?? {});
	if (!parsed.success) return { close: null, eps: null, pe: null, pb: null, peerMedianPe: null };
	return {
		close: parsed.data.close,
		eps: parsed.data.eps_basic,
		pe: parsed.data.pe,
		pb: parsed.data.price_book,
		peerMedianPe: parsed.data.peer_median_pe
	};
}

const insiderConvictionRationale = z.object({
	market_cap: numberOrNull.default(null)
});

/** Market cap rides in the insider-conviction rationale (computed for the whole universe). */
export function parseMarketCap(raw: unknown): number | null {
	const parsed = insiderConvictionRationale.safeParse(raw ?? {});
	return parsed.success ? parsed.data.market_cap : null;
}

const insiderComponents = z.object({
	size_score: numberOrNull.default(null),
	cluster_factor: numberOrNull.default(null),
	sell_dampen: numberOrNull.default(null),
	contrarian_boost: numberOrNull.default(null),
	buyer_count: numberOrNull.default(null),
	buy_value_eur: numberOrNull.default(null),
	sell_value_eur: numberOrNull.default(null),
	weighted_buy_eur: numberOrNull.default(null),
	floor_eur: numberOrNull.default(null),
	passes_size_gate: booleanOrNull.default(null),
	passes_cluster_gate: booleanOrNull.default(null),
	bought_into_decline: booleanOrNull.default(null)
});

/** Insider-conviction severity sub-components; fields are null on rows from older engine versions. */
export interface InsiderComponentsView {
	sizeScore: number | null;
	clusterFactor: number | null;
	sellDampen: number | null;
	contrarianBoost: number | null;
	buyerCount: number | null;
	buyValueEur: number | null;
	sellValueEur: number | null;
	weightedBuyEur: number | null;
	floorEur: number | null;
	passesSizeGate: boolean | null;
	passesClusterGate: boolean | null;
	boughtIntoDecline: boolean | null;
}

export function parseInsiderComponents(raw: unknown): InsiderComponentsView {
	const parsed = insiderComponents.safeParse(raw ?? {});
	const d = parsed.success ? parsed.data : insiderComponents.parse({});
	return {
		sizeScore: d.size_score,
		clusterFactor: d.cluster_factor,
		sellDampen: d.sell_dampen,
		contrarianBoost: d.contrarian_boost,
		buyerCount: d.buyer_count,
		buyValueEur: d.buy_value_eur,
		sellValueEur: d.sell_value_eur,
		weightedBuyEur: d.weighted_buy_eur,
		floorEur: d.floor_eur,
		passesSizeGate: d.passes_size_gate,
		passesClusterGate: d.passes_cluster_gate,
		boughtIntoDecline: d.bought_into_decline
	};
}

const relativeValueComponents = z.object({
	pe: numberOrNull.default(null),
	peer_median_pe: numberOrNull.default(null),
	peer_count: numberOrNull.default(null),
	peer_group: stringOrNull.default(null),
	discount_to_peer_median: numberOrNull.default(null),
	dividend_yield: numberOrNull.default(null),
	knife_guard: booleanOrNull.default(null)
});

/** Relative-value severity sub-components; peer fields only exist for rows that reached the peer comparison. */
export interface RelativeValueComponentsView {
	pe: number | null;
	peerMedianPe: number | null;
	peerCount: number | null;
	peerGroup: string | null;
	discountToPeerMedian: number | null;
	dividendYield: number | null;
	knifeGuard: boolean | null;
}

export function parseRelativeValueComponents(raw: unknown): RelativeValueComponentsView {
	const parsed = relativeValueComponents.safeParse(raw ?? {});
	const d = parsed.success ? parsed.data : relativeValueComponents.parse({});
	return {
		pe: d.pe,
		peerMedianPe: d.peer_median_pe,
		peerCount: d.peer_count,
		peerGroup: d.peer_group,
		discountToPeerMedian: d.discount_to_peer_median,
		dividendYield: d.dividend_yield,
		knifeGuard: d.knife_guard
	};
}

const reasonRow = z.object({
	signal: z.string(),
	severity: z.number().finite(),
	headline: z.string()
});

const surfacedRationale = z.object({
	reasons: z.array(reasonRow).catch([]).default([])
});

export interface ReasonRow {
	signal: string;
	severity: number;
	headline: string;
}

/** Fired-signal evidence list from a surfaced-feed rationale. */
export function parseReasons(raw: unknown): ReasonRow[] {
	const parsed = surfacedRationale.safeParse(raw ?? {});
	return parsed.success ? parsed.data.reasons : [];
}

const headlineRationale = z.object({ headline: z.string().catch('').default('') });

/** Evidence one-liner from a component-signal rationale ('' when absent). */
export function parseHeadline(raw: unknown): string {
	const parsed = headlineRationale.safeParse(raw ?? {});
	return parsed.success ? parsed.data.headline : '';
}
