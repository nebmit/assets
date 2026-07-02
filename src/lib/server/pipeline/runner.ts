import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { ingestionRun } from '../db/schema.js';
import type { Job, JobStats } from './types.js';

export interface JobRunResult {
	job: string;
	ok: boolean;
	stats?: JobStats;
	error?: string;
}

/** Run one job with ingestion_run bookkeeping; never throws. */
export async function runJob(db: Db, job: Job, runDate: string): Promise<JobRunResult> {
	const [row] = await db
		.insert(ingestionRun)
		.values({ source: job.source, job: job.name, status: 'running' })
		.returning({ id: ingestionRun.id });

	const log = (message: string) => console.log(`[${job.name}] ${message}`);
	try {
		const stats = await job.run({ db, runDate, log });
		await db
			.update(ingestionRun)
			.set({ status: 'success', finishedAt: new Date(), stats })
			.where(eq(ingestionRun.id, row.id));
		log(`done ${JSON.stringify(stats)}`);
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
export async function runJobs(db: Db, jobs: Job[], runDate: string): Promise<JobRunResult[]> {
	const results: JobRunResult[] = [];
	for (const job of jobs) {
		results.push(await runJob(db, job, runDate));
	}
	return results;
}
