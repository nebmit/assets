/**
 * Pure display formatting, shared by server and client. Conventions follow
 * the design system: monospaced tabular figures, explicit signs with a true
 * minus (U+2212), terse English date labels, no locale surprises.
 */

const DAY_MS = 86_400_000;

/**
 * Compact EUR amount for dense rows: "1.24M", "820k", "2.10B", "999".
 * Two decimals for millions and above (matches the design's insider rows),
 * whole thousands for "k".
 */
export function formatCompactEur(value: number): string {
	const abs = Math.abs(value);
	const sign = value < 0 ? '−' : '';
	if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
	if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
	if (abs >= 1e3) return `${sign}${Math.round(abs / 1e3)}k`;
	return `${sign}${Math.round(abs)}`;
}

/** Price with two decimals and narrow no-break-space thousands grouping ("1 720.40"). */
export function formatPrice(value: number): string {
	const [int, frac] = Math.abs(value).toFixed(2).split('.');
	const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
	return `${value < 0 ? '−' : ''}${grouped}.${frac}`;
}

/** "12 Jun" — day + short month, for row-level dates. Accepts date or timestamp ISO strings. */
export function formatDayMonth(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

/** "01 Jul 2026" — for the as-of line. */
export function formatDayMonthYear(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleDateString('en-GB', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
}

/** Signed percentage with a true minus: "+48.20%", "−7.90%", "0.00%". */
export function formatSignedPercent(value: number, decimals = 2): string {
	const sign = value > 0 ? '+' : value < 0 ? '−' : '';
	return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

/** Ratio (P/E and friends) with one decimal: "42.1". */
export function formatRatio(value: number): string {
	return value.toFixed(1);
}

/**
 * Age-based row opacity for insider trades: fresh rows are fully opaque,
 * older ones fade linearly — but never below 0.5, so the oldest trade
 * stays legible (per the design handoff). ≤7 days → 1.0; ≥90 days → 0.5.
 */
export function ageOpacity(dateIso: string, asOfIso: string): number {
	const daysAgo = (Date.parse(asOfIso) - Date.parse(dateIso)) / DAY_MS;
	if (daysAgo <= 7) return 1;
	return Math.max(0.5, 1 - ((daysAgo - 7) * 0.5) / 83);
}

/** The feed header's as-of line. We only ingest EOD data — no intraday time. */
export function formatAsOf(dateIso: string): string {
	return `As of ${formatDayMonthYear(dateIso)} · EOD close · Börse Frankfurt`;
}
