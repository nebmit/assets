import type { Db } from '../db/index.js';

export interface JobContext {
	db: Db;
	/** Calendar date (Europe/Berlin) this pipeline run is for. */
	runDate: string;
	log(message: string): void;
}

export type JobStats = Record<string, number | string>;

export interface Job {
	name: string;
	source: string;
	run(ctx: JobContext): Promise<JobStats>;
}
