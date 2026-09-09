import type { Db } from '../db/index.js';
import { resolveSnapshots, runCutoff } from '../assets/snapshot.js';
import type { UniverseContext } from './types.js';
export const INSIDER_WINDOW_DAYS = 30;
export async function buildContext(db: Db, runDate: string): Promise<UniverseContext> {
	return { runDate, instruments: await resolveSnapshots(db, runDate, runCutoff(runDate)) };
}
