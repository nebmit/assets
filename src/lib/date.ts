/** Subtract whole calendar years from an ISO date, clamping leap day to February 28. */
export function subtractYears(isoDay: string, years: number): string {
	const date = new Date(`${isoDay}T12:00:00Z`);
	const targetYear = date.getUTCFullYear() - years;
	const month = date.getUTCMonth();
	const maxDay = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
	const day = Math.min(date.getUTCDate(), maxDay);
	return `${String(targetYear).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
