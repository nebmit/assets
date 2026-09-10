import { financialDocuments } from '../store.js';
import { writeFile, readFile } from 'node:fs/promises';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { sourceFiling, secProcessing } from '../../../db/schema.js';
import type { JobContext } from '../../../pipeline/types.js';
import { selectedEntities } from '../selection.js';
import { processFinancialFiling } from './process.js';
import { resolveSnapshots } from '../../../assets/snapshot.js';
import type { ResearchSnapshot } from '../../../assets/snapshot.js';

export function compareSnapshots(before: ResearchSnapshot[], after: ResearchSnapshot[]) {
	const previous = new Map(before.map((s) => [s.assetId, s]));
	const current = new Map(after.map((s) => [s.assetId, s]));
	const changes: { assetId: string; metric: string; before: unknown; after: unknown }[] = [];
	const coverage: Record<string, number> = {};
	for (const [assetId, snapshot] of current) for (const [metric, result] of Object.entries(snapshot.financials)) {
		const key = `${metric}:${result.state}:${result.reasonCode ?? result.reason ?? 'qualified'}`;
		coverage[key] = (coverage[key] ?? 0) + 1;
		const old = previous.get(assetId)?.financials[metric as keyof ResearchSnapshot['financials']];
		if (old?.value !== result.value || old?.state !== result.state || old?.reason !== result.reason) changes.push({ assetId, metric, before: old ?? null, after: result });
	}
	return { coverage, changes, missingAssets: [...previous.keys()].filter((id) => !current.has(id)), addedAssets: [...current.keys()].filter((id) => !previous.has(id)) };
}

/** Reprocessing never calls the signal publisher. Compare artifacts are separate from published runs. */
export async function replayFundamentals(ctx: JobContext, options: { accession?: string; acquire?: boolean; retryFailed?: boolean; allPeriods?: boolean; output: string; baseline?: string }) {
	const entities = await selectedEntities(ctx);
	const ids = entities.map((e) => e.id);
	if (!ids.length) throw new Error('Empty replay selection');
	const filings = await ctx.db.select().from(sourceFiling).where(and(inArray(sourceFiling.issuerId, ids), sql`${sourceFiling.form} ~ '^10-(K|Q)(/A)?$' and ${sourceFiling.filedDate} <= ${ctx.runDate} and ${sourceFiling.filedDate} >= ${`${Number(ctx.runDate.slice(0, 4)) - 4}-01-01`}`, options.accession ? eq(sourceFiling.externalId, options.accession) : undefined)).orderBy(sql`${sourceFiling.filedDate} desc`);
	let complete = 0, failed = 0;
	const selected = options.accession || options.allPeriods ? filings : entities.flatMap((entity) => financialDocuments(filings.filter((f) => f.issuerId === entity.id), ctx.runDate));
	for (const filing of selected) {
		if (options.retryFailed) await ctx.db.update(secProcessing).set({ retryAt: new Date(0) }).where(and(eq(secProcessing.filingId, filing.id), eq(secProcessing.status, 'failed')));
		const result = await processFinancialFiling(ctx, filing, !options.acquire);
		if (result.ok) complete++; else failed++;
		if ((complete + failed) % 25 === 0) ctx.log(`replay: ${complete} complete, ${failed} failed of ${selected.length}`);
	}
	const snapshots = (await resolveSnapshots(ctx.db, ctx.runDate, new Date(), true)).filter((s) => ids.includes(s.issuerId));
	let baseline: ResearchSnapshot[] = [];
	if (options.baseline) {
		const rows = JSON.parse(await readFile(options.baseline, 'utf8')) as (ResearchSnapshot | { payload: ResearchSnapshot })[];
		baseline = rows.map((row) => 'payload' in row ? row.payload : row).filter((s) => ids.includes(s.issuerId));
	}
	const report = { runDate: ctx.runDate, generatedAt: new Date().toISOString(), parser: 'arelle-2.43.1:1', offline: !options.acquire, complete, failed, ...compareSnapshots(baseline, snapshots), snapshots };
	await writeFile(options.output, JSON.stringify(report));
	return { complete, failed, output: options.output };
}
