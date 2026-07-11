import { describe, expect, it } from 'vitest';
import { subtractYears } from './date.js';

describe('subtractYears', () => {
	it('subtracts calendar years without drifting across leap years', () => {
		expect(subtractYears('2026-07-11', 3)).toBe('2023-07-11');
		expect(subtractYears('2024-02-29', 3)).toBe('2021-02-28');
	});
});
