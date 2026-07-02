import type {
	CardData,
	InsiderRowView,
	NewsRowView,
	PricePoint
} from '../../screener/types.js';
import type { RelativeValueView } from './rationale.js';

/** A composite gate-passer joined with its instrument + issuer identity. */
export interface PasserRow {
	instrumentId: number;
	issuerId: number;
	rank: number;
	isin: string;
	wkn: string | null;
	name: string;
	sector: string | null;
}

export interface LatestPriceView {
	close: number;
	tradeDate: string;
	hi52: number;
	lo52: number;
}

/**
 * Pure merge of the per-source query results into render-ready cards.
 * Preserves passer (rank) order; any missing side-data degrades to null/[]
 * so a sparse universe still renders every card.
 */
export function assembleCards(
	passers: PasserRow[],
	valuationByInstrument: ReadonlyMap<number, RelativeValueView>,
	marketCapByInstrument: ReadonlyMap<number, number | null>,
	seriesByInstrument: ReadonlyMap<number, PricePoint[]>,
	latestByInstrument: ReadonlyMap<number, LatestPriceView>,
	insidersByIssuer: ReadonlyMap<number, InsiderRowView[]>,
	newsByIssuer: ReadonlyMap<number, NewsRowView[]>
): CardData[] {
	return passers.map((p) => {
		const valuation = valuationByInstrument.get(p.instrumentId);
		const latest = latestByInstrument.get(p.instrumentId);
		const pe = valuation?.pe ?? null;
		const peerMedianPe = valuation?.peerMedianPe ?? null;
		const peDeltaPct =
			pe !== null && peerMedianPe !== null && peerMedianPe !== 0
				? ((pe - peerMedianPe) / peerMedianPe) * 100
				: null;
		return {
			instrumentId: p.instrumentId,
			isin: p.isin,
			wkn: p.wkn,
			name: p.name,
			sector: p.sector,
			rank: p.rank,
			price: latest?.close ?? valuation?.close ?? null,
			priceDate: latest?.tradeDate ?? null,
			series: seriesByInstrument.get(p.instrumentId) ?? [],
			hi52: latest?.hi52 ?? null,
			lo52: latest?.lo52 ?? null,
			pe,
			peerMedianPe,
			peDeltaPct,
			eps: valuation?.eps ?? null,
			marketCap: marketCapByInstrument.get(p.instrumentId) ?? null,
			insiders: insidersByIssuer.get(p.issuerId) ?? [],
			news: newsByIssuer.get(p.issuerId) ?? []
		};
	});
}
