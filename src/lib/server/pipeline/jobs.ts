import { constituentsJob, masterDataJob } from '../sources/boerseFrankfurt/universe.js';
import type { Job } from './types.js';

/** The daily pre-market pipeline, in dependency order. */
export const allJobs: Job[] = [constituentsJob, masterDataJob];

export function findJob(name: string): Job | undefined {
	return allJobs.find((job) => job.name === name);
}
