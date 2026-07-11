import { subtractYears } from './date.js';
import type { PricePoint } from './feed/types.js';

/**
 * Pure sparkline geometry + range math, shared by the Sparkline component and
 * the hover-scrub overlay so guideline/dot land exactly on the drawn line.
 */

export type ChartRange = '1M' | '3M' | '6M' | '1Y' | '3Y';

export const CHART_RANGES: readonly ChartRange[] = ['1M', '3M', '6M', '1Y', '3Y'];

const RANGE_DAYS: Record<Exclude<ChartRange, '3Y'>, number> = {
	'1M': 30,
	'3M': 91,
	'6M': 182,
	'1Y': 365
};

export interface SparkGeometry {
	/** Pixel coordinates of each data point, in order. */
	pts: [number, number][];
	linePath: string;
	areaPath: string;
	pad: number;
}

/**
 * Map a value series onto SVG pixel space. Inset by `strokeWidth + 1` on all
 * sides so round caps and the last-point dot aren't clipped; a flat series
 * renders as a midline.
 */
export function sparkGeometry(
	values: number[],
	width: number,
	height: number,
	strokeWidth: number
): SparkGeometry {
	const pad = strokeWidth + 1;
	if (values.length === 0) return { pts: [], linePath: '', areaPath: '', pad };
	const min = Math.min(...values);
	const max = Math.max(...values);
	const range = max - min || 1;
	const stepX = (width - pad * 2) / (values.length - 1 || 1);
	const pts: [number, number][] = values.map((v, i) => [
		pad + i * stepX,
		pad + (1 - (v - min) / range) * (height - pad * 2)
	]);
	const linePath = pts
		.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
		.join(' ');
	const last = pts[pts.length - 1];
	const first = pts[0];
	const areaPath = `${linePath} L${last[0].toFixed(2)},${height} L${first[0].toFixed(2)},${height} Z`;
	return { pts, linePath, areaPath, pad };
}

/** Nearest data-point index for a cursor at `x` over a chart `width` px wide. */
export function nearestIndex(x: number, width: number, count: number): number {
	if (count <= 1 || width <= 0) return 0;
	const idx = Math.round((x / width) * (count - 1));
	return Math.max(0, Math.min(count - 1, idx));
}

/** Trailing window of the series for a display range, cut by date relative to `asOf`. */
export function sliceByRange(series: PricePoint[], range: ChartRange, asOf: string): PricePoint[] {
	const cutoff =
		range === '3Y'
			? Date.parse(subtractYears(asOf, 3))
			: Date.parse(asOf) - RANGE_DAYS[range] * 86_400_000;
	return series.filter((p) => Date.parse(p.date) >= cutoff);
}

/** Percent change first → last over the visible window; 0 for degenerate input. */
export function rangeChangePct(values: number[]): number {
	if (values.length < 2) return 0;
	const first = values[0];
	const last = values[values.length - 1];
	if (first === 0) return 0;
	return ((last - first) / first) * 100;
}
