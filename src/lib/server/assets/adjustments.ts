import type { Action } from './financials.js';

/** Cash dividends do not change the share basis; acquisitions do not rescale the acquirer's existing shares. */
export function blocksShareAdjustment(action: Action, symbol: string | null): boolean {
	if (action.qualification === 'qualified' || action.type === 'cash_dividends') return false;
	if (['cash_mergers', 'stock_mergers', 'stock_and_cash_mergers'].includes(action.type) && symbol && action.metadata.acquirer_symbol === symbol && action.metadata.acquiree_symbol !== symbol) return false;
	return true;
}
