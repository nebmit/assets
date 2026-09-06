import type { Db } from '../db/index.js';

export interface IssuerSelection {
	/** Null explicitly requests the full universe. */
	indices: string[] | null;
	/** Frozen CIK union for this run, resolved from a dated holdings snapshot. */
	ciks?: string[];
}

export interface JobContext {
	db: Db;
	/** Optional SEC replay filter; never changes the German universe. */
	cik?: string;
	issuerSelection?: IssuerSelection;
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

export type JobOptions = Pick<JobContext, 'cik' | 'issuerSelection'>;
