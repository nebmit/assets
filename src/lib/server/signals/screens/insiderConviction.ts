import { daysBetween } from '../../util.js';
import { INSIDER_WINDOW_DAYS } from '../context.js';
import type { ScreenDefinition } from '../types.js';

const HALF_LIFE_DAYS = 14;

/** Board members carry more information than related parties. */
const ROLE_WEIGHTS = {
	executive_board: 1.0,
	supervisory_board: 0.8,
	other: 0.6, // "Sonstige Führungsperson"
	related_party: 0.5
} as const;

/** Only share dealings count; derivatives/debt are noise for this screen. */
const COUNTED_INSTRUMENT_TYPE = 'Aktie';

/**
 * Insider Conviction: net insider share buying over the last 30 days,
 * scored by size (relative to market cap), buyer clustering, seniority and
 * recency. Gate: strictly positive net buy value.
 */
export const insiderConvictionScreen: ScreenDefinition = {
	slug: 'insider_conviction',
	name: 'Insider Conviction',
	version: 1,
	params: {
		window_days: INSIDER_WINDOW_DAYS,
		half_life_days: HALF_LIFE_DAYS,
		role_weights: ROLE_WEIGHTS,
		instrument_type: COUNTED_INSTRUMENT_TYPE
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
		let decayedNet = 0;
		let weightedRoleSum = 0;
		const buyers = new Set<string>();
		for (const tx of counted) {
			const amount = tx.amount as number;
			const age = Math.max(0, daysBetween(tx.transactionDate, ctx.runDate));
			const decay = Math.pow(0.5, age / HALF_LIFE_DAYS);
			if (tx.side === 'buy') {
				buyValue += amount;
				decayedNet += amount * decay;
				weightedRoleSum += amount * ROLE_WEIGHTS[tx.partyRole];
				buyers.add(tx.partyName ?? 'unknown');
			} else {
				sellValue += amount;
				decayedNet -= amount * decay;
			}
		}
		const netBuyValue = buyValue - sellValue;

		const rationale: Record<string, unknown> = {
			buy_value_eur: buyValue,
			sell_value_eur: sellValue,
			net_buy_value_eur: netBuyValue,
			decayed_net_buy_eur: decayedNet,
			buyer_count: buyers.size,
			market_cap: instrument.marketCap,
			transactions: counted.map((tx) => ({
				party: tx.partyName,
				role: tx.partyRole,
				side: tx.side,
				amount_eur: tx.amount,
				transaction_date: tx.transactionDate,
				published_date: tx.publishedDate
			}))
		};

		if (netBuyValue <= 0 || decayedNet <= 0 || buyValue === 0) {
			return { passedGate: false, score: null, rationale };
		}

		const roleFactor = weightedRoleSum / buyValue;
		const clusterFactor = 1 + Math.log(buyers.size);
		// normalize by market cap so a 100k buy in a small cap outranks one in SAP;
		// fall back to a fixed reference size when market cap is unknown
		const sizeNorm = decayedNet / (instrument.marketCap ?? 1e10);
		const score = sizeNorm * clusterFactor * roleFactor;

		rationale.role_factor = roleFactor;
		rationale.cluster_factor = clusterFactor;
		rationale.size_norm = sizeNorm;
		return { passedGate: true, score, rationale };
	}
};
