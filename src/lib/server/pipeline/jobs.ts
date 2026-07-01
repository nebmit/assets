import { signalsJob } from '../signals/engine.js';
import { insiderJob } from '../sources/bafin/insider.js';
import { keyDataJob } from '../sources/boerseFrankfurt/keyData.js';
import { pricesJob } from '../sources/boerseFrankfurt/prices.js';
import { constituentsJob, masterDataJob } from '../sources/boerseFrankfurt/universe.js';
import type { Job } from './types.js';

/** The daily pre-market pipeline, in dependency order (signals last). */
export const allJobs: Job[] = [
	constituentsJob,
	masterDataJob,
	pricesJob,
	keyDataJob,
	insiderJob,
	signalsJob
];

export function findJob(name: string): Job | undefined {
	return allJobs.find((job) => job.name === name);
}
