import { secJobs, secReconcileJob } from '../sources/sec/jobs.js';
import { signalsJob } from '../signals/engine.js';
import { performanceJob } from '../signals/performance.js';
import { insiderJob } from '../sources/bafin/insider.js';
import { shortPositionsJob } from '../sources/bundesanzeiger/shortPositions.js';
import { newsJob } from '../sources/boerseFrankfurt/news.js';
import { pricesJob } from '../sources/boerseFrankfurt/prices.js';
import { snapshotJob } from '../sources/boerseFrankfurt/snapshot.js';
import { constituentsJob, masterDataJob } from '../sources/boerseFrankfurt/universe.js';
import type { Job } from './types.js';

/**
 * The daily pre-market pipeline, in dependency order.
 * Snapshot runs before prices so fresh closes make price_history requests
 * unnecessary in steady state.
 */
export const allJobs: Job[] = [
	constituentsJob,
	masterDataJob,
	snapshotJob,
	pricesJob,
	insiderJob,
	shortPositionsJob,
	// news last among ingesters: its ~7-min rate-limited walk feeds no signal
	newsJob,
	signalsJob,
	// measure forward returns of past surfaced signals once horizons elapse
	performanceJob,
	// SEC research ingestion currently feeds no product signals. Complete German results first.
	...secJobs
];

export function findJob(name: string): Job | undefined {
	return [...allJobs, secReconcileJob].find((job) => job.name === name);
}

/** The same registry serves one-off runs and the scheduler; source is only a filter. */
export function selectJobs(jobName = 'all', source?: string, reconcile = false): Job[] {
	if (source && !allJobs.some((job) => job.source === source)) throw new Error(`unknown source "${source}"`);
	let jobs: Job[];
	if (jobName === 'all') jobs = allJobs.filter((job) => !source || job.source === source);
	else {
		const job = findJob(jobName);
		if (!job) throw new Error(`unknown job "${jobName}"`);
		if (source && job.source !== source) throw new Error(`job "${jobName}" does not belong to source "${source}"`);
		jobs = [job];
	}
	if (reconcile && jobName === 'all') jobs = jobs.flatMap((job) => job.name === 'sec_universe' ? [job, secReconcileJob] : [job]);
	return jobs;
}
