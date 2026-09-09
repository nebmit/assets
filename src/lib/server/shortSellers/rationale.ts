import { z } from 'zod';
import { unknownShortSellers, type ShortSellerAnalysis } from '../../shortSellers.js';

export const shortSellerAnalysisSchema = z.object({
	status: z.enum(['present', 'none_disclosed', 'unknown', 'unavailable']),
	freshness: z.enum(['fresh', 'stale', 'unavailable']),
	snapshotId: z.number().int().positive().nullable(),
	capturedAt: z.string().datetime().nullable(),
	holderCount: z.number().int().nonnegative().nullable(),
	totalDisclosedPct: z.number().finite().nonnegative().nullable(),
	holders: z.array(z.object({ holderName: z.string(), positionPct: z.number().finite().nonnegative(), positionDate: z.string() }))
});

export function parseShortSellerRationale(raw: unknown): ShortSellerAnalysis {
	const parsed = z.object({ shortSellers: shortSellerAnalysisSchema }).safeParse(raw);
	return parsed.success ? parsed.data.shortSellers : unknownShortSellers();
}
