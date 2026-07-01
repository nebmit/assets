/**
 * Worker entrypoint. Grows with the pipeline: `schedule` runs the daily
 * pre-market batch on a cron, `run` executes jobs once, `report` prints
 * ranked signals, `migrate` applies pending DB migrations.
 */
import { closeDb, runMigrations } from '../lib/server/db/index.js';

const command = process.argv[2] ?? 'schedule';

async function main(): Promise<void> {
	switch (command) {
		case 'migrate':
			await runMigrations();
			console.log('migrations applied');
			break;
		case 'schedule':
		case 'run':
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
