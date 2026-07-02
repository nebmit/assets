import { z } from 'zod';

/**
 * Tolerant readers for signal rationale JSONB. Rationale shapes are owned by
 * the screen definitions, but rows may come from older engine versions or be
 * partially populated (e.g. peer fields only exist for relative-value gate
 * passers) — so every field degrades to null instead of throwing.
 */

const numberOrNull = z.number().finite().nullable().catch(null);

const relativeValueRationale = z.object({
	close: numberOrNull.default(null),
	eps_basic: numberOrNull.default(null),
	pe: numberOrNull.default(null),
	peer_median_pe: numberOrNull.default(null)
});

export interface RelativeValueView {
	close: number | null;
	eps: number | null;
	pe: number | null;
	peerMedianPe: number | null;
}

export function parseRelativeValueRationale(raw: unknown): RelativeValueView {
	const parsed = relativeValueRationale.safeParse(raw ?? {});
	if (!parsed.success) return { close: null, eps: null, pe: null, peerMedianPe: null };
	return {
		close: parsed.data.close,
		eps: parsed.data.eps_basic,
		pe: parsed.data.pe,
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
