import { formatCompactEur } from '../../../format.js';
import { daysBetween } from '../../util.js';
import { INSIDER_WINDOW_DAYS } from '../context.js';
import type { SignalDefinition } from '../types.js';

/**
 * Decay from *publication*, not the trade date: a filing is new information
 * the day it becomes public, and stays "news" for roughly three weeks.
 */
export const HALF_LIFE_DAYS = 21;

/** Board members carry more information than related parties. */
export const ROLE_WEIGHTS = {
	executive_board: 1.0,
	supervisory_board: 0.85,
	other: 0.7, // "Sonstige Führungsperson"
	related_party: 0.6
} as const;

/** Only share dealings count; derivatives/debt are noise for this signal. */
export const COUNTED_INSTRUMENT_TYPE = 'Aktie';

/** Publication-age decay factor in (0, 1] applied to a dealing's EUR amount. */
export function publicationDecay(publishedDate: string, runDate: string): number {
	const age = Math.max(0, daysBetween(publishedDate, runDate));
	return Math.pow(0.5, age / HALF_LIFE_DAYS);
}

/** 3-month drop at which "buying into a falling price" starts to count. */
export const DECLINE_THRESHOLD = 0.1;

/**
 * Absolute materiality floor (EUR, role-weighted decayed buying) per cap
 * band — a purchase must be larger at a DAX name than at an SDAX name to
 * mean anything. This is what lets an empty day be empty.
 */
const BUY_FLOOR_EUR = { DAX: 100_000, MDAX: 50_000, SDAX: 25_000 } as const;

/** A ≥2-buyer cluster qualifies at half the floor: agreement beats size. */
const CLUSTER_FLOOR_FRACTION = 0.5;

/** Buying at floor × this multiple saturates the size component at 1. */
const SATURATION_MULTIPLE = 50;

/**
 * Sells only dampen, never erase, buys: insider sales are mostly
 * non-informative (diversification, tax, option mechanics), so a large
 * planned sale must not gate out a genuine buying cluster.
 */
const SELL_DAMPING = 0.5;

const CLUSTER_STEP = 0.25;
const CLUSTER_FACTOR_MAX = 1.75;

/** Cap on the contrarian boost for buying into a falling price. */
const CONTRARIAN_BOOST_MAX = 0.5;

/**
 * Insider Conviction: role-weighted, publication-decayed insider share
 * *buying* over the last 30 days. Gate: an absolute, cap-band-aware
 * materiality floor (halved for ≥2-buyer clusters). Severity in [0, 1]:
 * saturating size vs the floor × buyer clustering × mild sell dampening ×
 * contrarian boost when insiders buy into a falling price. ~0.2 barely
 * clears the floor, ~0.5 is strong, ~1 is exceptional.
 */
export const insiderConvictionSignal: SignalDefinition = {
	slug: 'insider_conviction',
	name: 'Insider Conviction',
	version: 3,
	params: {
		window_days: INSIDER_WINDOW_DAYS,
		half_life_days: HALF_LIFE_DAYS,
		role_weights: ROLE_WEIGHTS,
		instrument_type: COUNTED_INSTRUMENT_TYPE,
		buy_floor_eur: BUY_FLOOR_EUR,
		cluster_floor_fraction: CLUSTER_FLOOR_FRACTION,
		saturation_multiple: SATURATION_MULTIPLE,
		sell_damping: SELL_DAMPING,
		cluster_step: CLUSTER_STEP,
		cluster_factor_max: CLUSTER_FACTOR_MAX,
		contrarian_boost_max: CONTRARIAN_BOOST_MAX,
		decline_threshold: DECLINE_THRESHOLD,
		severity_scale: '0.2 = at floor, 0.5 = strong, 1 = exceptional'
	},
	evaluate(instrument, ctx) {
		const counted = instrument.insiderTx.filter(
			(tx) =>
				tx.instrumentType === COUNTED_INSTRUMENT_TYPE &&
				(tx.side === 'buy' || tx.side === 'sell') &&
				tx.amount !== null &&
				tx.amount > 0
		);

		let buyValue = 0;
		let sellValue = 0;
		let weightedBuys = 0;
		const namedBuyers = new Set<string>();
		let hasUnnamedBuyer = false;
		let newestPublished: string | null = null;
		for (const tx of counted) {
			const amount = tx.amount as number;
			if (tx.side === 'sell') {
				sellValue += amount;
				continue;
			}
			buyValue += amount;
			weightedBuys += amount * ROLE_WEIGHTS[tx.partyRole] * publicationDecay(tx.publishedDate, ctx.runDate);
			if (tx.partyName === null) hasUnnamedBuyer = true;
			else namedBuyers.add(tx.partyName);
			if (newestPublished === null || tx.publishedDate > newestPublished) {
				newestPublished = tx.publishedDate;
			}
		}
		// unnamed filings can't prove distinct people, so they count as one buyer at most
		const buyerCount = namedBuyers.size + (hasUnnamedBuyer ? 1 : 0);
		const floor = BUY_FLOOR_EUR[instrument.indexName];

		const rationale: Record<string, unknown> = {
			buy_value_eur: buyValue,
			sell_value_eur: sellValue,
			weighted_buy_eur: weightedBuys,
			buyer_count: buyerCount,
			floor_eur: floor,
			market_cap: instrument.marketCap,
			newest_published: newestPublished,
			return_3m: instrument.return3m,
			transactions: counted.map((tx) => ({
				party: tx.partyName,
				role: tx.partyRole,
				side: tx.side,
				amount_eur: tx.amount,
				transaction_date: tx.transactionDate,
				published_date: tx.publishedDate
			}))
		};

		const passesSize = buyValue > 0 && weightedBuys >= floor;
		const passesCluster =
			buyValue > 0 && buyerCount >= 2 && weightedBuys >= floor * CLUSTER_FLOOR_FRACTION;
		const drop = Math.max(0, -(instrument.return3m ?? 0));
		rationale.passes_size_gate = passesSize;
		rationale.passes_cluster_gate = passesCluster;
		rationale.bought_into_decline = buyValue > 0 && drop >= DECLINE_THRESHOLD;
		if (!passesSize && !passesCluster) {
			return { passedGate: false, score: null, rationale };
		}

		const sizeScore = Math.min(1, Math.log1p(weightedBuys / floor) / Math.log1p(SATURATION_MULTIPLE));
		const clusterFactor = Math.min(CLUSTER_FACTOR_MAX, 1 + CLUSTER_STEP * (buyerCount - 1));
		const sellDampen = buyValue / (buyValue + SELL_DAMPING * sellValue);
		const contrarianBoost = 1 + Math.min(CONTRARIAN_BOOST_MAX, drop);
		const severity = Math.min(1, sizeScore * clusterFactor * sellDampen * contrarianBoost);

		rationale.size_score = sizeScore;
		rationale.cluster_factor = clusterFactor;
		rationale.sell_dampen = sellDampen;
		rationale.contrarian_boost = contrarianBoost;
		rationale.headline = insiderHeadline(buyerCount, buyValue, drop);
		return { passedGate: true, score: severity, eventDate: newestPublished, rationale };
	}
};

function insiderHeadline(buyerCount: number, buyValue: number, drop: number): string {
	const who = buyerCount === 1 ? '1 insider' : `${buyerCount} insiders`;
	const intoWeakness = drop >= DECLINE_THRESHOLD ? ' into a falling price' : '';
	return `${who} bought €${formatCompactEur(buyValue)} in 30d${intoWeakness}`;
}
