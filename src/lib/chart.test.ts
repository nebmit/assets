import { describe, expect, it } from 'vitest';
import { nearestIndex, rangeChangePct, sliceByRange, sparkGeometry } from './chart.js';
import type { PricePoint } from './feed/types.js';

describe('sparkGeometry', () => {
	it('maps min/max onto padded vertical extremes', () => {
		const g = sparkGeometry([10, 20], 100, 50, 2);
		const pad = 3;
		expect(g.pad).toBe(pad);
		expect(g.pts[0]).toEqual([pad, 50 - pad]); // min → bottom
		expect(g.pts[1]).toEqual([100 - pad, pad]); // max → top
		expect(g.linePath.startsWith('M')).toBe(true);
		expect(g.areaPath.endsWith('Z')).toBe(true);
	});

	it('renders a flat series as a midline', () => {
		const g = sparkGeometry([5, 5, 5], 90, 40, 1.75);
		const ys = g.pts.map(([, y]) => y);
		expect(new Set(ys).size).toBe(1);
		expect(ys[0]).toBeGreaterThan(0);
		expect(ys[0]).toBeLessThan(40);
	});

	it('handles empty input', () => {
		const g = sparkGeometry([], 100, 50, 2);
		expect(g.pts).toEqual([]);
		expect(g.linePath).toBe('');
	});
});

describe('nearestIndex', () => {
	it('snaps cursor position to the closest point', () => {
		expect(nearestIndex(0, 100, 5)).toBe(0);
		expect(nearestIndex(100, 100, 5)).toBe(4);
		expect(nearestIndex(52, 100, 5)).toBe(2);
	});

	it('clamps out-of-bounds and degenerate input', () => {
		expect(nearestIndex(-30, 100, 5)).toBe(0);
		expect(nearestIndex(500, 100, 5)).toBe(4);
		expect(nearestIndex(50, 100, 1)).toBe(0);
		expect(nearestIndex(50, 0, 5)).toBe(0);
	});
});

describe('sliceByRange', () => {
	const series: PricePoint[] = [
		{ date: '2025-07-10', close: 100 },
		{ date: '2026-01-05', close: 110 },
		{ date: '2026-06-10', close: 120 },
		{ date: '2026-06-28', close: 130 }
	];

	it('cuts by trailing date window', () => {
		expect(sliceByRange(series, '1M', '2026-07-01').map((p) => p.close)).toEqual([120, 130]);
		expect(sliceByRange(series, '6M', '2026-07-01').map((p) => p.close)).toEqual([110, 120, 130]);
		expect(sliceByRange(series, '1Y', '2026-07-01')).toHaveLength(4);
	});
});

describe('rangeChangePct', () => {
	it('computes first → last percent change', () => {
		expect(rangeChangePct([100, 134.2])).toBeCloseTo(34.2);
		expect(rangeChangePct([100, 91.6])).toBeCloseTo(-8.4);
	});

	it('returns 0 for degenerate input', () => {
		expect(rangeChangePct([])).toBe(0);
		expect(rangeChangePct([50])).toBe(0);
		expect(rangeChangePct([0, 10])).toBe(0);
	});
});
