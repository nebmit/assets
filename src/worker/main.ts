import './env.js';
import { parseSelection } from '../lib/server/sources/sec/selection.js';
import type { JobOptions } from '../lib/server/pipeline/types.js';
import { secReport } from '../lib/server/sources/sec/jobs.js';
import { cik as normalizeCik, date as secDate } from '../lib/server/sources/sec/parse.js';
import { transportStats } from '../lib/server/sources/sec/client.js';
/**
 * Worker entrypoint.
 *   schedule            run the daily pre-market batch on a cron (default)
 *   run [--job=x|all] [--date=YYYY-MM-DD]   execute selected jobs to completion
 *   backfill [--source=sec]              drain the selected backlog without a cycle budget
 *   report [--signal=x] [--date=..]          print surfaced signals
 *   migrate             apply pending DB migrations
 */
import { Cron } from 'croner';
import { config } from '../lib/server/config.js';
import { closeDb, getDb, runMigrations } from '../lib/server/db/index.js';
import { selectJobs } from '../lib/server/pipeline/jobs.js';
import { runJobs } from '../lib/server/pipeline/runner.js';
import { signalDefinitions, SURFACED_SLUG } from '../lib/server/signals/engine.js';
import {
	latestRunDate,
	performanceSummary,
	signalReport,
	summarizeRationale
} from '../lib/server/signals/report.js';
import { isoDate } from '../lib/server/util.js';
import { pruneRawArchive } from '../lib/server/rawArchive.js';

function arg(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function fail(message: string): never {
	throw new Error(message);
}

function secOptions(): JobOptions {
	return arg('cik') !== undefined ? { cik: normalizeCik(arg('cik')) } : { issuerSelection: parseSelection(arg('indices')) };
}

async function runPipeline(jobNames: 'all' | string, runDate: string): Promise<boolean> {
	const scheduled = (process.argv[2] ?? 'schedule') === 'schedule';
	const sunday = new Date(runDate + 'T12:00:00Z').getUTCDay() === 0;
	const jobs = selectJobs(jobNames, arg('source'), scheduled && sunday);
	const hasSec = jobs.some((job) => job.source === 'sec');
	const before = { ...transportStats }, started = Date.now();
	const results = await runJobs(getDb(), jobs, runDate, hasSec ? secOptions() : {});
	if (hasSec) console.log(JSON.stringify({ sec_requests: transportStats.requests - before.requests, sec_bytes: transportStats.bytes - before.bytes, elapsed_ms: Date.now() - started }));
	const failures = results.filter((r) => !r.ok).length;
	console.log(`run ${runDate}: ${results.length - failures}/${results.length} jobs succeeded`);
	if (jobNames === 'all' && !arg('source')) {
		// Bounded raw-archive disk usage; a cleanup hiccup never fails the run.
		try {
			const removed = await pruneRawArchive(runDate);
			if (removed > 0) console.log(`pruned ${removed} raw archive day(s) past retention`);
		} catch (err) {
			console.error('raw archive prune failed:', err);
		}
	}
	return failures === 0;
}

async function schedule(): Promise<void> {
	await runMigrations();
	const settings = config();
	const { INGEST_CRON, TZ } = settings;
	const cron = new Cron(INGEST_CRON, { timezone: TZ, protect: true }, async () => {
		try {
			await runPipeline('all', isoDate(new Date(), TZ));
		} catch (err) {
			console.error('scheduled run failed:', err);
		}
	});
	console.log(`scheduler started: "${INGEST_CRON}" (${TZ}), next run ${cron.nextRun()?.toISOString()}`);

	await new Promise<void>((resolve) => {
		const stop = () => {
			console.log('shutting down');
			cron.stop();
			resolve();
		};
		process.on('SIGTERM', stop);
		process.on('SIGINT', stop);
	});
}

async function report(): Promise<void> {
	const db = getDb();
	if (arg('source') === 'sec') {
		const data = await secReport({ db, runDate: arg('date') ?? isoDate(new Date(), config().TZ), log: console.log, ...secOptions() });
		if (arg('format') && !['json', 'text'].includes(arg('format')!)) fail('format must be json or text');
		console.log(JSON.stringify(data, null, arg('format') === 'json' ? undefined : 2));
		return;
	}
	const runDate = arg('date') ?? (await latestRunDate(db));
	if (!runDate) throw new Error('no signal runs found — run the pipeline first');
	const top = Number(arg('top') ?? 10);
	const slugs = arg('signal') ? [arg('signal') as string] : [SURFACED_SLUG, ...signalDefinitions.map((s) => s.slug)];

	for (const slug of slugs) {
		const data = await signalReport(db, slug, runDate, top);
		if (!data) throw new Error(`no signals for "${slug}" on ${runDate}`);
		console.log(`\n${slug} — ${runDate} (universe ${data.universeSize}, ${data.passed} surfaced)`);
		for (const row of data.top) {
			const ticker = (row.ticker ?? '—').padEnd(6);
			const severity = row.score.toFixed(2).padStart(5);
			console.log(
				`  #${String(row.rank).padStart(2)} ${ticker} ${severity}  ${row.name}  [${summarizeRationale(slug, row.rationale)}]`
			);
		}
	}

	const performance = await performanceSummary(getDb());
	if (performance.length > 0) {
		console.log('\nforward returns of surfaced signals (vs equal-weight universe):');
		for (const row of performance) {
			const excess = row.avgExcess === null ? '   n/a' : `${(row.avgExcess * 100).toFixed(1).padStart(6)}%`;
			const hit = row.hitRate === null ? ' n/a' : `${Math.round(row.hitRate * 100)}%`;
			console.log(
				`  ${row.signal.padEnd(20)} ${String(row.horizonDays).padStart(3)}d  n=${String(row.n).padStart(4)}  avg ${(row.avgReturn * 100).toFixed(1).padStart(6)}%  excess ${excess}  hit ${hit}`
			);
		}
	}
}

async function main(): Promise<void> {
	const command = process.argv[2] ?? 'schedule';
	const jobs = selectJobs(arg('job') ?? 'all', arg('source'));
	const hasSec = jobs.some((job) => job.source === 'sec');
	if ((arg('cik') !== undefined || arg('indices') !== undefined) && !hasSec) fail('--cik and --indices require a run containing SEC jobs');
	if (arg('cik') !== undefined && arg('indices') !== undefined) fail('choose --cik or --indices');
	if (arg('limit') !== undefined || arg('seed') !== undefined) fail('use --indices to select the SEC universe');
	if (hasSec) secOptions();
	if (arg('date')) secDate.parse(arg('date'));
	if (command === 'schedule' && arg('job')) fail('schedule selects job groups with --source, not --job');
	switch (command) {
		case 'reprocess': {
			const output = arg('output');
			if (!output) fail('reprocess requires --output=path for its candidate report');
			const { replayFundamentals } = await import('../lib/server/sources/sec/xbrl/replay.js');
			await runMigrations();
			const result = await replayFundamentals({ db: getDb(), runDate: arg('date') ?? isoDate(new Date(), config().TZ), log: console.log, ...secOptions() }, { output, accession: arg('accession'), baseline: arg('baseline'), acquire: process.argv.includes('--acquire'), retryFailed: process.argv.includes('--retry-failed'), allPeriods: process.argv.includes('--all-periods') });
			console.log(JSON.stringify(result));
			if (result.failed) process.exitCode = 1;
			break;
		}
		case 'migrate':
			await runMigrations();
			console.log('migrations applied');
			break;
		case 'backfill':
		case 'run':
			await runMigrations();
			if (!(await runPipeline(arg('job') ?? 'all', arg('date') ?? isoDate(new Date(), config().TZ))))
				process.exitCode = 1;
			break;
		case 'schedule':
			await schedule();
			break;
		case 'report':
			await report();
			break;
		default:
			throw new Error(`unknown command "${command}" (expected: schedule | run | backfill | report | migrate | reprocess)`);
	}
}

main()
	.then(() => closeDb())
	.catch(async (err) => {
		console.error(err);
		await closeDb();
		process.exit(1);
	});
