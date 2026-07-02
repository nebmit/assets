import { describe, expect, it } from 'vitest';
import {
	ageOpacity,
	formatAsOf,
	formatCompactEur,
	formatDayMonth,
	formatDayMonthYear,
	formatPrice,
	formatRatio,
	formatSignedPercent
} from './format.js';

describe('formatCompactEur', () => {
	it('formats millions with two decimals', () => {
		expect(formatCompactEur(1_240_000)).toBe('1.24M');
		expect(formatCompactEur(2_800_000)).toBe('2.80M');
	});

	it('formats thousands as whole k', () => {
		expect(formatCompactEur(820_000)).toBe('820k');
		expect(formatCompactEur(640_499)).toBe('640k');
	});

	it('formats billions and small values', () => {
		expect(formatCompactEur(8_500_000_000)).toBe('8.50B');
		expect(formatCompactEur(999)).toBe('999');
		expect(formatCompactEur(0)).toBe('0');
	});

	it('uses a true minus for negatives', () => {
		expect(formatCompactEur(-1_600_000)).toBe('−1.60M');
	});
});

describe('formatPrice', () => {
	it('always shows two decimals', () => {
		expect(formatPrice(245.8)).toBe('245.80');
		expect(formatPrice(28.937)).toBe('28.94');
	});

	it('groups thousands with narrow no-break space', () => {
		expect(formatPrice(1720.4)).toBe('1 720.40');
	});
});

describe('date labels', () => {
	it('formats day + short month', () => {
		expect(formatDayMonth('2026-06-12')).toBe('12 Jun');
		expect(formatDayMonth('2026-06-27T15:04:00Z')).toBe('27 Jun');
	});

	it('formats day + month + year', () => {
		expect(formatDayMonthYear('2026-07-01')).toBe('01 Jul 2026');
	});

	it('builds the as-of line', () => {
		expect(formatAsOf('2026-07-01')).toBe('As of 01 Jul 2026 · EOD close · Börse Frankfurt');
	});
});

describe('formatSignedPercent', () => {
	it('signs with + / U+2212 / nothing', () => {
		expect(formatSignedPercent(48.2)).toBe('+48.20%');
		expect(formatSignedPercent(-7.9)).toBe('−7.90%');
		expect(formatSignedPercent(-7.9).charCodeAt(0)).toBe(0x2212);
		expect(formatSignedPercent(0)).toBe('0.00%');
	});

	it('respects decimals', () => {
		expect(formatSignedPercent(12.345, 1)).toBe('+12.3%');
	});
});

describe('formatRatio', () => {
	it('renders one decimal', () => {
		expect(formatRatio(42.1)).toBe('42.1');
		expect(formatRatio(19.84)).toBe('19.8');
	});
});

describe('ageOpacity', () => {
	const asOf = '2026-07-01';

	it('is fully opaque for fresh rows', () => {
		expect(ageOpacity('2026-07-01', asOf)).toBe(1);
		expect(ageOpacity('2026-06-24', asOf)).toBe(1);
	});

	it('never drops below the 0.5 floor', () => {
		expect(ageOpacity('2026-04-02', asOf)).toBe(0.5);
		expect(ageOpacity('2024-01-01', asOf)).toBe(0.5);
	});

	it('decays monotonically in between', () => {
		const mid = ageOpacity('2026-05-14', asOf);
		expect(mid).toBeGreaterThan(0.5);
		expect(mid).toBeLessThan(1);
		expect(ageOpacity('2026-06-01', asOf)).toBeGreaterThan(mid);
	});
});
