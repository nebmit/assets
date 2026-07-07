/**
 * Worker entrypoint.
 *   schedule            run the daily pre-market batch on a cron (default)
 *   run [--job=x|all] [--date=YYYY-MM-DD]   execute jobs once
 *   report [--signal=x] [--date=..]          print surfaced signals
 *   migrate             apply pending DB migrations
 */
import { Cron } from 'croner';
import { config } from '../lib/server/config.js';
import { closeDb, getDb, runMigrations } from '../lib/server/db/index.js';
import { allJobs, findJob } from '../lib/server/pipeline/jobs.js';
import { runJobs } from '../lib/server/pipeline/runner.js';
import { signalDefinitions, SURFACED_SLUG } from '../lib/server/signals/engine.js';
import {
	latestRunDate,
	performanceSummary,
	signalReport,
	summarizeRationale
} from '../lib/server/signals/report.js';
import { isoDate } from '../lib/server/util.js';

function arg(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function fail(message: string): never {
	throw new Error(message);
}

async function runPipeline(jobNames: 'all' | string, runDate: string): Promise<boolean> {
	const jobs = jobNames === 'all' ? allJobs : [findJob(jobNames) ?? fail(`unknown job "${jobNames}"`)];
	const results = await runJobs(getDb(), jobs, runDate);
	const failures = results.filter((r) => !r.ok).length;
	console.log(`run ${runDate}: ${results.length - failures}/${results.length} jobs succeeded`);
	return failures === 0;
}

async function schedule(): Promise<void> {
	await runMigrations();
	const { INGEST_CRON, TZ } = config();
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
	switch (command) {
		case 'migrate':
			await runMigrations();
			console.log('migrations applied');
			break;
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
			throw new Error(`unknown command "${command}" (expected: schedule | run | report | migrate)`);
	}
}

main()
	.then(() => closeDb())
	.catch(async (err) => {
		console.error(err);
		await closeDb();
		process.exit(1);
	});
