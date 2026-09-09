import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { issuer, sourceFiling, ingestionRun } from '../../db/schema.js';
import type { IssuerSelection, JobContext } from '../../pipeline/types.js';

export const DEFAULT_SEC_INDICES = ['sp500', 'sp400'];
export const SEC_INDICES = ['sp500', 'sp400'];
export function parseSelection(value = DEFAULT_SEC_INDICES.join(',')): IssuerSelection {
	if (value === 'all') return { indices: null };
	const indices = [...new Set(value.split(',').map((s) => s.trim()))].sort();
	if (!indices.length || indices.some((s) => !SEC_INDICES.includes(s))) throw new Error('--indices must be a comma-separated list of sp500, sp400, or all');
	return { indices };
}
export function isScoped(ctx: Pick<JobContext, 'cik' | 'issuerSelection'>): boolean {
	return Boolean(ctx.cik || ctx.issuerSelection?.indices);
}
export function secJobName(name: string, ctx: Pick<JobContext, 'cik' | 'issuerSelection'>): string {
	if (ctx.cik) return `${name}:${ctx.cik}`;
	const indices = ctx.issuerSelection?.indices;
	return indices ? `${name}:indices:${[...indices].sort().join('+')}` : name;
}

/** Reuse the last successful universe snapshot for standalone jobs and reports. Never widen a failed selection. */
export async function selectedEntities(ctx: JobContext) {
	if (ctx.cik) return ctx.db.select().from(issuer).where(eq(issuer.cik, ctx.cik));
	const selection = ctx.issuerSelection;
	if (!selection?.indices) return ctx.db.select().from(issuer).where(isNotNull(issuer.cik));
	if (selection.ciks === undefined) {
		const [run] = await ctx.db.select().from(ingestionRun).where(and(eq(ingestionRun.source, 'sec'),
			eq(ingestionRun.job, secJobName('sec_universe', ctx)), eq(ingestionRun.status, 'success'), sql`${ingestionRun.stats}->>'selection_ciks' is not null`))
			.orderBy(sql`${ingestionRun.finishedAt} desc`).limit(1);
		const encoded = (run?.stats as Record<string, unknown> | undefined)?.selection_ciks;
		if (typeof encoded !== 'string') throw new Error(`No index universe snapshot; run --source=sec --job=sec_universe --indices=${selection.indices.join(',')} first`);
		selection.ciks = z.array(z.string().regex(/^\d{10}$/)).nonempty().parse(JSON.parse(encoded));
	}
	return selection.ciks.length ? ctx.db.select().from(issuer).where(inArray(issuer.cik, selection.ciks)) : [];
}
export function filingScope(ctx: Pick<JobContext, 'cik' | 'issuerSelection'>, issuerIds: number[]) {
	return isScoped(ctx) ? (issuerIds.length ? inArray(sourceFiling.issuerId, issuerIds) : sql`false`) : undefined;
}
