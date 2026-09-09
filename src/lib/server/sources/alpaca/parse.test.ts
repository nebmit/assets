import { describe, expect, it } from 'vitest';
import { parseBars, parseActions, actionSymbols } from './parse.js';
import { acceptanceTime } from '../sec/parse.js';
const bar = { t: '2026-03-09T04:00:00Z', o: 10, h: 12, l: 9, c: 11, v: 100 };
describe('Alpaca observations', () => {
	it('preserves pagination and New York session dates across DST', () => {
		const result = parseBars({ bars: { TEST: [bar, { ...bar, t: '2026-01-05T05:00:00Z' }] }, next_page_token: 'next' }, new Set(['TEST']), '2026-03-09');
		expect(result.rows.map((r) => r.tradeDate)).toEqual(['2026-03-09', '2026-01-05']); expect(result.next).toBe('next');
		expect(acceptanceTime('2026-01-05T23:59:59')).toBe('2026-01-06T04:59:59.000Z');
		expect(acceptanceTime('2026-03-09T23:59:59')).toBe('2026-03-10T03:59:59.000Z');
	});
	it('excludes incomplete days, rejects unrequested symbols and inconsistent OHLC', () => {
		expect(parseBars({ bars: { TEST: [bar] }, next_page_token: null }, new Set(['TEST']), '2026-03-08').rows).toEqual([]);
		expect(() => parseBars({ bars: { WRONG: [bar] }, next_page_token: null }, new Set(['TEST']), '2026-03-09')).toThrow('Unexpected');
		expect(() => parseBars({ bars: { TEST: [{ ...bar, c: 15 }] }, next_page_token: null }, new Set(['TEST']), '2026-03-09')).toThrow('OHLC');
	});
	it('records splits, paid cash evidence and unsupported actions distinctly', () => {
		const result = parseActions({ corporate_actions: { forward_splits: [{ id: 's', symbol: 'TEST', ex_date: '2026-03-01', old_rate: 1, new_rate: 10 }], cash_dividends: [{ id: 'd', symbol: 'TEST', ex_date: '2026-03-01', rate: 0.5, foreign: false, payable_date: '2026-03-10' }], spin_offs: [{ id: 'u', symbol: 'TEST', ex_date: '2026-03-01' }] }, next_page_token: null });
		expect(result.actions.map((a) => [a.ratio, a.currency, a.qualification])).toEqual([['10', null, 'qualified'], [null, 'USD', 'qualified'], [null, null, 'unqualified']]);
	});
	it('matches mergers requested through the acquirer without discarding the acquiree evidence', () => {
		const action = parseActions({ corporate_actions: { cash_mergers: [{ id: 'merger', acquiree_symbol: 'AMAM', acquirer_symbol: 'JNJ', effective_date: '2024-03-07', rate: 28 }] }, next_page_token: null }).actions[0];
		expect(actionSymbols(action)).toEqual(['AMAM', 'JNJ']);
		expect(action.qualification).toBe('unqualified');
	});
	it('qualifies symbol continuity only with matching CUSIP evidence', () => {
		const row = { id: 'n', old_symbol: 'OLD', new_symbol: 'NEW', effective_date: '2026-03-01', old_cusip: '123', new_cusip: '456' };
		expect(parseActions({ corporate_actions: { name_changes: [row] }, next_page_token: null }).actions[0].qualification).toBe('unqualified');
		expect(parseActions({ corporate_actions: { name_changes: [{ ...row, new_cusip: '123' }] }, next_page_token: null }).actions[0].qualification).toBe('qualified');
	});
});
