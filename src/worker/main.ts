/**
 * Worker entrypoint.
 *   schedule            run the daily pre-market batch on a cron (default)
 *   run [--job=x|all] [--date=YYYY-MM-DD]   execute jobs once
 *   report [--screen=x] [--date=..]         print ranked signals
 *   migrate             apply pending DB migrations
 */
import { Cron } from 'croner';
import { config } from '../lib/server/config.js';
import { closeDb, getDb, runMigrations } from '../lib/server/db/index.js';
import { allJobs, findJob } from '../lib/server/pipeline/jobs.js';
import { runJobs } from '../lib/server/pipeline/runner.js';
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

async function main(): Promise<void> {
	const command = process.argv[2] ?? 'schedule';
	switch (command) {
		case 'migrate':
			await runMigrations();
			console.log('migrations applied');
			break;
		case 'run':
			await runMigrations();
			if (!(await runPipeline(arg('job') ?? 'all', arg('date') ?? isoDate()))) process.exitCode = 1;
			break;
		case 'schedule':
			await schedule();
			break;
		case 'report':
			throw new Error(`command "${command}" not implemented yet`);
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
