import { describe, expect, it } from 'vitest';
import { blocksShareAdjustment } from './adjustments.js';
import type { Action } from './financials.js';
const action = (type: string, metadata = {}): Action => ({ id: 1, instrumentId: 1, source: 'alpaca', externalId: 'event', type, exDate: '2026-03-01', ratio: null, amount: null, currency: null, observedAt: new Date(), sourceRecordId: 'event', evidence: {}, qualification: 'unqualified', metadata });
describe('share-basis corporate actions', () => {
	it('does not block acquirer prices or shares on an acquisition', () => {
		const a = action('cash_mergers', { acquirer_symbol: 'ABT', acquiree_symbol: 'EXAS' });
		expect(blocksShareAdjustment(a, 'ABT')).toBe(false);
		expect(blocksShareAdjustment(a, 'EXAS')).toBe(true);
		expect(blocksShareAdjustment(a, null)).toBe(true);
	});
	it('separates cash-dividend qualification from share adjustment', () => {
		expect(blocksShareAdjustment(action('cash_dividends'), 'TEST')).toBe(false);
		expect(blocksShareAdjustment(action('spin_offs'), 'TEST')).toBe(true);
		expect(blocksShareAdjustment(action('name_changes'), 'TEST')).toBe(true);
	});
});
