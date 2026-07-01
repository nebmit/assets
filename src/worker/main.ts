/**
 * Worker entrypoint. Grows with the pipeline: `schedule` runs the daily
 * pre-market batch on a cron, `run` executes jobs once, `report` prints
 * ranked signals.
 */
const command = process.argv[2] ?? 'schedule';

switch (command) {
	case 'schedule':
	case 'run':
	case 'report':
		console.error(`command "${command}" not implemented yet`);
		process.exit(1);
		break;
	default:
		console.error(`unknown command "${command}" (expected: schedule | run | report)`);
		process.exit(1);
}
