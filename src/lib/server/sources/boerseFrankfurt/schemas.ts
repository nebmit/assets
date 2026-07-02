import { z } from 'zod';

// Schemas are deliberately lenient (only the fields we consume, everything
// else ignored) so cosmetic API changes don't break ingestion.

const translated = z.object({ originalValue: z.string().nullable() });

export const equitySearchRow = z.object({
	isin: z.string(),
	wkn: z.string().nullish(),
	slug: z.string().nullish(),
	name: translated,
	keyData: z
		.object({
			earningsPerShareBasic: z.number().nullish(),
			marketCapitalisation: z.number().nullish(),
			dividendPerShare: z.number().nullish()
		})
		.nullish(),
	overview: z
		.object({
			lastPrice: z.number().nullish(),
			dateTimeLastPrice: z.string().nullish()
		})
		.nullish()
});
export type EquitySearchRow = z.infer<typeof equitySearchRow>;

export const equitySearchResponse = z.object({
	recordsTotal: z.number(),
	data: z.array(equitySearchRow)
});
export type EquitySearchResponse = z.infer<typeof equitySearchResponse>;

export const instrumentInformation = z.object({
	isin: z.string(),
	exchangeSymbol: z.string().nullish(),
	wkn: z.string().nullish(),
	instrumentName: translated.nullish(),
	mics: z.array(z.string()).nullish()
});
export type InstrumentInformation = z.infer<typeof instrumentInformation>;

export const equityMasterData = z.object({
	isin: z.string().nullish(),
	sector: translated.nullish(),
	subsector: translated.nullish()
});
export type EquityMasterData = z.infer<typeof equityMasterData>;

export const priceHistoryResponse = z.object({
	// handshake-gated endpoints degrade to `{}` when the handshake is rejected;
	// keep these optional so we can detect that case and fail loudly
	isin: z.string().optional(),
	totalCount: z.number().optional(),
	data: z
		.array(
			z.object({
				date: z.string(),
				open: z.number().nullable(),
				high: z.number().nullable(),
				low: z.number().nullable(),
				close: z.number(),
				turnoverPieces: z.number().nullable(),
				turnoverEuro: z.number().nullable()
			})
		)
		.optional()
});
export type PriceHistoryResponse = z.infer<typeof priceHistoryResponse>;

export const equityKeyData = z.object({
	isin: z.string().nullish(),
	numberOfShares: z.number().nullish(),
	marketCapitalization: z.number().nullish(),
	/** "Gewinn pro Aktie" — earnings per share, basic. */
	winPerShare: z.number().nullish(),
	dividendPerShare: z.number().nullish(),
	dividendYear: z.number().nullish()
});
export type EquityKeyData = z.infer<typeof equityKeyData>;
