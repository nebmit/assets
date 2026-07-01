import { daysBetween } from '../../util.js';
import { median } from '../stats.js';
import type { ScreenDefinition, UniverseContext, UniverseInstrument } from '../types.js';

const MAX_PE = 200;
const MIN_SECTOR_PEERS = 5;
/** Stale price guard: close must be at most this many days old. */
const MAX_CLOSE_AGE_DAYS = 10;

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
	bySector: Map<string, { median: number; count: number }>;
	byIndex: Map<string, { median: number; count: number }>;
}

const mediansCache = new WeakMap<UniverseContext, PeerMedians>();

function peerMedians(ctx: UniverseContext): PeerMedians {
	let cached = mediansCache.get(ctx);
	if (cached) return cached;

	const peByInstrument = new Map<number, number>();
	const sectorPes = new Map<string, number[]>();
	const indexPes = new Map<string, number[]>();
	for (const instrument of ctx.instruments) {
		const pe = validPe(instrument, ctx.runDate);
		if (pe === null) continue;
		peByInstrument.set(instrument.instrumentId, pe);
		if (instrument.sector !== null) {
			sectorPes.set(instrument.sector, [...(sectorPes.get(instrument.sector) ?? []), pe]);
		}
		indexPes.set(instrument.indexName, [...(indexPes.get(instrument.indexName) ?? []), pe]);
	}
	cached = {
		peByInstrument,
		bySector: new Map(
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
 * Relative Value: P/E (derived from latest close and point-in-time EPS)
 * versus the sector median where enough peers exist, otherwise the index
 * median. Gate: positive earnings and a sane, fresh P/E. Score: relative
 * discount to the peer median (cheaper = higher).
 */
export const relativeValueScreen: ScreenDefinition = {
	slug: 'relative_value',
	name: 'Relative Value',
	version: 1,
	params: { max_pe: MAX_PE, min_sector_peers: MIN_SECTOR_PEERS, max_close_age_days: MAX_CLOSE_AGE_DAYS },
	evaluate(instrument, ctx) {
		const medians = peerMedians(ctx);
		const pe = medians.peByInstrument.get(instrument.instrumentId) ?? null;
		const rationale: Record<string, unknown> = {
			close: instrument.close,
			close_date: instrument.closeDate,
			eps_basic: instrument.epsBasic,
			pe
		};
		if (pe === null) {
			return { passedGate: false, score: null, rationale };
		}

		const sector = instrument.sector === null ? undefined : medians.bySector.get(instrument.sector);
		const peers =
			sector !== undefined && sector.count >= MIN_SECTOR_PEERS
				? { group: `sector:${instrument.sector}`, ...sector }
				: { group: `index:${instrument.indexName}`, ...(medians.byIndex.get(instrument.indexName) as { median: number; count: number }) };

		const discount = (peers.median - pe) / peers.median;
		rationale.peer_group = peers.group;
		rationale.peer_count = peers.count;
		rationale.peer_median_pe = peers.median;
		rationale.discount_to_peer_median = discount;
		return { passedGate: true, score: discount, rationale };
	}
};
