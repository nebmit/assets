import { createHash } from 'node:crypto';

/** Calendar date (YYYY-MM-DD) of `date` in the given IANA timezone. */
export function isoDate(date: Date = new Date(), timeZone = 'Europe/Berlin'): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

export function addDays(isoDay: string, days: number): string {
	const d = new Date(`${isoDay}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function md5(input: string): string {
	return createHash('md5').update(input).digest('hex');
}

export function sha256(input: string): string {
	return createHash('sha256').update(input).digest('hex');
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
