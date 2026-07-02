import { describe, expect, it } from 'vitest';
import { median, percentileRanks } from './stats.js';

describe('median', () => {
	it('handles odd, even and empty inputs', () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([1, 2, 3, 4])).toBe(2.5);
		expect(median([])).toBeNull();
	});
});

describe('percentileRanks', () => {
	it('ranks scores as fraction of cohort <= score', () => {
		expect(percentileRanks([10, 20, 30, 40])).toEqual([0.25, 0.5, 0.75, 1]);
	});
	it('gives ties the same percentile', () => {
		expect(percentileRanks([5, 5, 1])).toEqual([1, 1, 1 / 3]);
	});
	it('gives a single passer percentile 1', () => {
		expect(percentileRanks([42])).toEqual([1]);
	});
});
