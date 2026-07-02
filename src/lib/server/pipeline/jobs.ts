import { signalsJob } from '../signals/engine.js';
import { insiderJob } from '../sources/bafin/insider.js';
import { pricesJob } from '../sources/boerseFrankfurt/prices.js';
import { snapshotJob } from '../sources/boerseFrankfurt/snapshot.js';
import { constituentsJob, masterDataJob } from '../sources/boerseFrankfurt/universe.js';
import type { Job } from './types.js';

/**
 * The daily pre-market pipeline, in dependency order (signals last).
 * Snapshot runs before prices so fresh closes make price_history requests
 * unnecessary in steady state.
 */
export const allJobs: Job[] = [
	constituentsJob,
	masterDataJob,
	snapshotJob,
	pricesJob,
	insiderJob,
	signalsJob
];

export function findJob(name: string): Job | undefined {
	return allJobs.find((job) => job.name === name);
}
