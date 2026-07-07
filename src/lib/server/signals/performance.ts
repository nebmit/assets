import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { signalPerformance } from '../db/schema.js';
import type { Job, JobStats } from '../pipeline/types.js';
import { addDays } from '../util.js';

/** Calendar-day horizons ≈ 1 / 3 / 6 months (21 / 63 / 126 trading days). */
export const HORIZONS_DAYS = [30, 91, 182] as const;

/** A forward close must exist within this many days before the horizon end. */
const FWD_TOLERANCE_DAYS = 10;

interface CloseRow {
	instrument_id: number;
	trade_date: string;
	close: string;
}

/**
 * Pure core: forward returns per instrument plus the equal-weight universe
 * mean, given base and forward closes (both maps instrumentId → close).
 */
export function forwardReturns(
	baseCloses: ReadonlyMap<number, number>,
	fwdCloses: ReadonlyMap<number, number>
): { byInstrument: Map<number, number>; universeMean: number | null } {
	const byInstrument = new Map<number, number>();
	for (const [instrumentId, base] of baseCloses) {
		const fwd = fwdCloses.get(instrumentId);
		if (fwd === undefined || base <= 0) continue;
		byInstrument.set(instrumentId, fwd / base - 1);
	}
	const returns = [...byInstrument.values()];
	const universeMean =
		returns.length === 0 ? null : returns.reduce((sum, r) => sum + r, 0) / returns.length;
	return { byInstrument, universeMean };
}

async function latestCloses(
	db: Db,
	instrumentIds: number[],
	onOrBefore: string,
	after: string
): Promise<Map<number, { close: number; tradeDate: string }>> {
	if (instrumentIds.length === 0) return new Map();
	const idList = sql.join(
		instrumentIds.map((id) => sql`${id}`),
		sql`, `
	);
	const rows = (await db.execute(sql`
		select distinct on (instrument_id) instrument_id, trade_date, close
		from eod_price
		where instrument_id in (${idList}) and trade_date <= ${onOrBefore} and trade_date > ${after}
		order by instrument_id, trade_date desc
	`)) as unknown as CloseRow[];
	return new Map(rows.map((r) => [r.instrument_id, { close: Number(r.close), tradeDate: r.trade_date }]));
}

/**
 * Fill signal_performance for every fired signal of past runs whose horizon
 * has elapsed by `runDate`. Idempotent: rows already computed are skipped
 * (unique on signal × horizon), so the job just catches up every day.
 */
export async function runPerformance(db: Db, runDate: string): Promise<JobStats> {
	let inserted = 0;
	let runsProcessed = 0;

	for (const horizon of HORIZONS_DAYS) {
		const runs = (await db.execute(sql`
			select r.id, r.run_date
			from signal_run r
			where r.status = 'success' and r.run_date <= ${addDays(runDate, -horizon)}
				and exists (
					select 1 from signal s
					where s.run_id = r.id and s.passed_gate
						and not exists (
							select 1 from signal_performance sp
							where sp.signal_id = s.id and sp.horizon_days = ${horizon}
						)
				)
			order by r.run_date
		`)) as unknown as { id: number; run_date: string }[];

		for (const run of runs) {
			const pending = (await db.execute(sql`
				select s.id as signal_id, s.instrument_id
				from signal s
				where s.run_id = ${run.id} and s.passed_gate
					and not exists (
						select 1 from signal_performance sp
						where sp.signal_id = s.id and sp.horizon_days = ${horizon}
					)
			`)) as unknown as { signal_id: number; instrument_id: number }[];
			if (pending.length === 0) continue;

			const universeIds = (await db.execute(sql`
				select distinct instrument_id from signal where run_id = ${run.id}
			`)) as unknown as { instrument_id: number }[];
			const ids = universeIds.map((r) => r.instrument_id);

			const horizonEnd = addDays(run.run_date, horizon);
			const base = await latestCloses(db, ids, run.run_date, addDays(run.run_date, -FWD_TOLERANCE_DAYS));
			const fwd = await latestCloses(db, ids, horizonEnd, addDays(horizonEnd, -FWD_TOLERANCE_DAYS));
			const { byInstrument, universeMean } = forwardReturns(
				new Map([...base].map(([id, row]) => [id, row.close])),
				new Map([...fwd].map(([id, row]) => [id, row.close]))
			);

			const rows = pending.flatMap((p) => {
				const fwdReturn = byInstrument.get(p.instrument_id);
				const baseRow = base.get(p.instrument_id);
				const fwdRow = fwd.get(p.instrument_id);
				if (fwdReturn === undefined || !baseRow || !fwdRow) return [];
				return [
					{
						signalId: p.signal_id,
						horizonDays: horizon,
						baseDate: baseRow.tradeDate,
						baseClose: baseRow.close.toString(),
						fwdDate: fwdRow.tradeDate,
						fwdClose: fwdRow.close.toString(),
						fwdReturn: fwdReturn.toString(),
						universeFwdReturn: universeMean?.toString() ?? null
					}
				];
			});
			if (rows.length > 0) {
				await db.insert(signalPerformance).values(rows).onConflictDoNothing();
				inserted += rows.length;
			}
			runsProcessed++;
		}
	}

	return { rows_inserted: inserted, run_horizons_processed: runsProcessed };
}

export const performanceJob: Job = {
	name: 'performance',
	source: 'engine',
	run: (ctx) => runPerformance(ctx.db, ctx.runDate)
};
