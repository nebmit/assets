import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { ingestionRun } from '../db/schema.js';
import { parseSelection, secJobName } from '../sources/sec/selection.js';
import type { Job, JobStats, JobOptions } from './types.js';

export interface JobRunResult {
	job: string;
	ok: boolean;
	stats?: JobStats;
	error?: string;
}

/** Run one job with ingestion_run bookkeeping; never throws. */
export async function runJob(db: Db, job: Job, runDate: string, options: JobOptions = {}): Promise<JobRunResult> {
	const [row] = await db
		.insert(ingestionRun)
		.values({ source: job.source, job: job.source === 'sec' ? secJobName(job.name, options) : job.name, status: 'running' })
		.returning({ id: ingestionRun.id });

	const log = (message: string) => console.log(`[${job.name}] ${message}`);
	try {
		const before = job.source === 'sec' ? { ...(await import('../sources/sec/client.js')).transportStats } : null;
		const started = Date.now();
		const context = { db, runDate, log, ...options };
		const stats = await job.run(context);
		if (before) {
			const after = (await import('../sources/sec/client.js')).transportStats;
			Object.assign(stats, { requests: after.requests - before.requests, bytes: after.bytes - before.bytes, elapsed_ms: Date.now() - started });
		}
		if (job.source === 'sec' && (Number(stats.failed ?? 0) > 0 || Number(stats.refresh_missing ?? 0) > 0 || Number(stats.deferred ?? 0) > 0 || Number(stats.pending ?? 0) > 0 || Number(stats.submissions_deferred ?? 0) > 0)) {
			const error = 'SEC job has incomplete work; inspect stats and filing errors, then rerun';
			await db.update(ingestionRun).set({ status: 'error', finishedAt: new Date(), stats, error }).where(eq(ingestionRun.id, row.id));
			console.error(`[${job.name}] INCOMPLETE: ${error}; ${JSON.stringify(stats, (key, value) => key === 'selection_ciks' ? undefined : value)}`);
			return { job: job.name, ok: false, stats, error };
		}
		await db
			.update(ingestionRun)
			.set({ status: 'success', finishedAt: new Date(), stats })
			.where(eq(ingestionRun.id, row.id));
		log(`done ${JSON.stringify(stats, (key, value) => key === 'selection_ciks' ? undefined : value)}`);
		return { job: job.name, ok: true, stats };
	} catch (err) {
		const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
		await db
			.update(ingestionRun)
			.set({ status: 'error', finishedAt: new Date(), error: message })
			.where(eq(ingestionRun.id, row.id));
		console.error(`[${job.name}] FAILED: ${message}`);
		return { job: job.name, ok: false, error: message };
	}
}

/**
 * Run jobs in dependency order. Failures are isolated: one source failing
 * must not block the others.
 */
export async function runJobs(db: Db, jobs: Job[], runDate: string, options: JobOptions = {}): Promise<JobRunResult[]> {
	const results: JobRunResult[] = [];
	let secIncomplete = false;
	for (let i = 0; i < jobs.length; i++) {
		const job = jobs[i];
		if (job.source !== 'sec') {
			if (secIncomplete && ['signals', 'performance'].includes(job.name)) {
				const error = 'skipped because SEC ingestion is incomplete; retain the previous dashboard snapshot';
				console.error(`[${job.name}] ${error}`);
				results.push({ job: job.name, ok: false, error });
				continue;
			}
			results.push(await runJob(db, job, runDate));
			continue;
		}
		const group: Job[] = [job];
		while (jobs[i + 1]?.source === 'sec') group.push(jobs[++i]);
		try {
			const completed = await runSecJobs(db, group, runDate, options);
			secIncomplete ||= completed.some((result) => !result.ok);
			results.push(...completed);
		}
		catch (error) {
			secIncomplete = true;
			const message = error instanceof Error ? error.message : String(error);
			console.error(`SEC ingestion failed: ${message}`);
			results.push(...group.map((job) => ({ job: job.name, ok: false, error: message })));
		}
	}
	return results;
}

/** SEC jobs commit independently while a dedicated connection owns the process lock. */
async function runSecJobs(db: Db, jobs: Job[], runDate: string, options: JobOptions): Promise<JobRunResult[]> {
	if (!options.cik && !options.issuerSelection) options = { ...options, issuerSelection: parseSelection() };
	const { default: postgres } = await import('postgres');
	const { config } = await import('../config.js');
	const lock = postgres(config().DATABASE_URL, { max: 1 });
	try {
		const [row] = await lock`select pg_try_advisory_lock(1936024434) as acquired`;
		if (!row.acquired) throw new Error('another SEC worker is already running');
		const results: JobRunResult[] = [];
		for (const job of jobs) {
			const result = await runJob(db, job, runDate, options);
			results.push(result);
			// Stop on source/discovery failure; item-level failures retain stats and allow other stages to recover.
			if (!result.ok && !result.stats) {
				for (const skipped of jobs.slice(results.length)) {
					const error = `skipped after ${job.name} failed`;
					console.error(`[${skipped.name}] ${error}`);
					results.push({ job: skipped.name, ok: false, error });
				}
				break;
			}
		}
		return results;
	} finally { await lock.end(); }
}
