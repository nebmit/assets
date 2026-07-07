import { formatRatio } from '../../../format.js';
import { daysBetween } from '../../util.js';
import { superSector } from '../sectors.js';
import { median } from '../stats.js';
import type { SignalDefinition, UniverseContext, UniverseInstrument } from '../types.js';

const MAX_PE = 200;
const MIN_SECTOR_PEERS = 5;
/** Stale price guard: close must be at most this many days old. */
const MAX_CLOSE_AGE_DAYS = 10;
/** Gate floor: at least this far below the peer median ("materially cheap"). */
const MIN_DISCOUNT = 0.15;
/** Discount at which the value component saturates at its maximum. */
const DISCOUNT_SATURATION = 0.6;
/**
 * Falling-knife guard: a stock that lost more than this over ~6 months is
 * "cheap" because the market is repricing it — gated out, not surfaced.
 */
const KNIFE_GUARD_RETURN_6M = -0.35;
/** Dividend-yield support: this yield contributes the full yield bonus. */
const YIELD_SATURATION = 0.04;
const YIELD_WEIGHT = 0.15;

function validPe(instrument: UniverseInstrument, runDate: string): number | null {
	if (
		instrument.close === null ||
		instrument.closeDate === null ||
		daysBetween(instrument.closeDate, runDate) > MAX_CLOSE_AGE_DAYS ||
		instrument.epsBasic === null ||
		instrument.epsBasic <= 0
	) {
		return null;
	}
	const pe = instrument.close / instrument.epsBasic;
	return pe > 0 && pe < MAX_PE ? pe : null;
}

interface PeerMedians {
	peByInstrument: Map<number, number>;
	bySuperSector: Map<string, { median: number; count: number }>;
	byIndex: Map<string, { median: number; count: number }>;
}

const mediansCache = new WeakMap<UniverseContext, PeerMedians>();

function peerMedians(ctx: UniverseContext): PeerMedians {
	let cached = mediansCache.get(ctx);
	if (cached) return cached;

	const peByInstrument = new Map<number, number>();
	const sectorPes = new Map<string, number[]>();
	const indexPes = new Map<string, number[]>();
	const append = (map: Map<string, number[]>, key: string, pe: number) => {
		const list = map.get(key);
		if (list) list.push(pe);
		else map.set(key, [pe]);
	};
	for (const instrument of ctx.instruments) {
		const pe = validPe(instrument, ctx.runDate);
		if (pe === null) continue;
		peByInstrument.set(instrument.instrumentId, pe);
		const bucket = superSector(instrument.sector);
		if (bucket !== null) append(sectorPes, bucket, pe);
		append(indexPes, instrument.indexName, pe);
	}
	cached = {
		peByInstrument,
		bySuperSector: new Map(
			[...sectorPes].map(([k, v]) => [k, { median: median(v) as number, count: v.length }])
		),
		byIndex: new Map(
			[...indexPes].map(([k, v]) => [k, { median: median(v) as number, count: v.length }])
		)
	};
	mediansCache.set(ctx, cached);
	return cached;
}

/**
 * Relative Value: P/E (latest close, point-in-time EPS) versus the
 * super-sector peer median (index median when too few peers). Gate: a
 * *material* discount (≥15%) with fresh prices and no falling knife — being
 * merely rankable is not being cheap. Severity in [0, 1]: saturating
 * discount depth plus a small dividend-yield support bonus.
 */
export const relativeValueSignal: SignalDefinition = {
	slug: 'relative_value',
	name: 'Relative Value',
	version: 2,
	params: {
		max_pe: MAX_PE,
		min_sector_peers: MIN_SECTOR_PEERS,
		max_close_age_days: MAX_CLOSE_AGE_DAYS,
		min_discount: MIN_DISCOUNT,
		discount_saturation: DISCOUNT_SATURATION,
		knife_guard_return_6m: KNIFE_GUARD_RETURN_6M,
		yield_saturation: YIELD_SATURATION,
		yield_weight: YIELD_WEIGHT,
		severity_scale: '0 = at the 15% discount floor, 1 = 60%+ discount with 4%+ yield'
	},
	evaluate(instrument, ctx) {
		const medians = peerMedians(ctx);
		const pe = medians.peByInstrument.get(instrument.instrumentId) ?? null;
		const dividendYield =
			instrument.dividendPerShare !== null && instrument.close !== null && instrument.close > 0
				? instrument.dividendPerShare / instrument.close
				: null;
		const rationale: Record<string, unknown> = {
			close: instrument.close,
			close_date: instrument.closeDate,
			eps_basic: instrument.epsBasic,
			pe,
			dividend_yield: dividendYield,
			return_6m: instrument.return6m
		};
		if (pe === null) {
			return { passedGate: false, score: null, rationale };
		}

		const bucket = superSector(instrument.sector);
		const sectorPeers = bucket === null ? undefined : medians.bySuperSector.get(bucket);
		const peers =
			sectorPeers !== undefined && sectorPeers.count >= MIN_SECTOR_PEERS
				? { group: `sector:${bucket}`, ...sectorPeers }
				: { group: `index:${instrument.indexName}`, ...(medians.byIndex.get(instrument.indexName) as { median: number; count: number }) };

		const discount = (peers.median - pe) / peers.median;
		rationale.peer_group = peers.group;
		rationale.peer_count = peers.count;
		rationale.peer_median_pe = peers.median;
		rationale.discount_to_peer_median = discount;

		if (discount < MIN_DISCOUNT) {
			return { passedGate: false, score: null, rationale };
		}
		if (instrument.return6m !== null && instrument.return6m <= KNIFE_GUARD_RETURN_6M) {
			rationale.knife_guard = true;
			return { passedGate: false, score: null, rationale };
		}

		const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
		const depth = clamp01((discount - MIN_DISCOUNT) / (DISCOUNT_SATURATION - MIN_DISCOUNT));
		const yieldBonus = clamp01((dividendYield ?? 0) / YIELD_SATURATION);
		const severity = Math.min(1, (1 - YIELD_WEIGHT) * depth + YIELD_WEIGHT * yieldBonus);

		rationale.headline = `P/E ${formatRatio(pe)}, ${Math.round(discount * 100)}% below ${peers.group.replace('sector:', '').replace('index:', '')} median`;
		return { passedGate: true, score: severity, eventDate: null, rationale };
	}
};
