/**
 * Worker entrypoint.
 *   schedule            run the daily pre-market batch on a cron (default)
 *   run [--job=x|all] [--date=YYYY-MM-DD]   execute jobs once
 *   report [--screen=x] [--date=..]         print ranked signals
 *   migrate             apply pending DB migrations
 */
import { closeDb, getDb, runMigrations } from '../lib/server/db/index.js';
import { allJobs, findJob } from '../lib/server/pipeline/jobs.js';
import { runJobs } from '../lib/server/pipeline/runner.js';
import { isoDate } from '../lib/server/util.js';

function arg(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function runOnce(): Promise<boolean> {
	const jobArg = arg('job') ?? 'all';
	const runDate = arg('date') ?? isoDate();
	const jobs = jobArg === 'all' ? allJobs : [findJob(jobArg) ?? fail(`unknown job "${jobArg}"`)];
	await runMigrations();
	const results = await runJobs(getDb(), jobs, runDate);
	const failed = results.filter((r) => !r.ok);
	console.log(`run ${runDate}: ${results.length - failed.length}/${results.length} jobs succeeded`);
	return failed.length === 0;
}

function fail(message: string): never {
	throw new Error(message);
}

async function main(): Promise<void> {
	const command = process.argv[2] ?? 'schedule';
	switch (command) {
		case 'migrate':
			await runMigrations();
			console.log('migrations applied');
			break;
		case 'run':
			if (!(await runOnce())) process.exitCode = 1;
			break;
		case 'schedule':
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
