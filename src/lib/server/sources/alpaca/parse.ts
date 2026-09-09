import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { date } from '../sec/parse.js';
import { isoDate } from '../../util.js';
const number = z.number().finite();
const bar = z.object({ t: z.string().datetime({ offset: true }), o: number.positive(), h: number.positive(), l: number.positive(), c: number.positive(), v: number.nonnegative().safe() });
export function parseBars(input: unknown, allowed: ReadonlySet<string>, through: string) {
	const page = z.object({ bars: z.record(z.array(bar)), next_page_token: z.string().nullable() }).parse(input);
	const rows: { symbol: string; tradeDate: string; open: string; high: string; low: string; close: string; volume: number }[] = [];
	for (const [symbol, bars] of Object.entries(page.bars)) {
		if (!allowed.has(symbol)) throw new Error(`Unexpected Alpaca symbol ${symbol}`);
		for (const b of bars) {
			const tradeDate = isoDate(new Date(b.t), 'America/New_York');
			if (tradeDate > through) continue;
			if (b.h < Math.max(b.o, b.c, b.l) || b.l > Math.min(b.o, b.c, b.h)) throw new Error('Inconsistent Alpaca OHLC');
			rows.push({ symbol, tradeDate, open: String(b.o), high: String(b.h), low: String(b.l), close: String(b.c), volume: b.v });
		}
	}
	return { rows, next: page.next_page_token };
}
export interface ParsedAction {
	externalId: string; symbol: string; type: string; exDate: string;
	ratio: string | null; amount: string | null; currency: string | null;
	qualification: string; metadata: Record<string, unknown>;
}
export function parseActions(input: unknown) {
	const page = z.object({ corporate_actions: z.record(z.array(z.record(z.unknown()))), next_page_token: z.string().nullable() }).parse(input);
	const actions: ParsedAction[] = [];
	for (const [type, rows] of Object.entries(page.corporate_actions)) for (const r of rows) {
		const exDate = date.parse(r.ex_date ?? r.effective_date ?? r.process_date);
		const symbol = z.string().min(1).parse(r.symbol ?? r.old_symbol ?? r.source_symbol ?? r.acquiree_symbol);
		const externalId = z.string().min(1).parse(r.id);
		let ratio: string | null = null, amount: string | null = null, currency: string | null = null, qualification = 'unqualified';
		if (['forward_splits', 'reverse_splits'].includes(type)) {
			const old = number.positive().parse(r.old_rate), next = number.positive().parse(r.new_rate);
			ratio = new Decimal(next).div(old).toString(); qualification = 'qualified';
		} else if (type === 'cash_dividends' && r.foreign === false) {
			amount = String(number.nonnegative().parse(r.rate)); currency = 'USD'; qualification = 'qualified';
		} else if (type === 'name_changes' && typeof r.new_symbol === 'string' && r.old_cusip === r.new_cusip && r.old_cusip) qualification = 'qualified';
		actions.push({ externalId, symbol, type, exDate, ratio, amount, currency, qualification, metadata: r });
	}
	return { actions, next: page.next_page_token };
}

/** Merger responses include both parties even when only the acquirer was requested. */
export function actionSymbols(action: ParsedAction): string[] {
	return [...new Set([action.symbol, ...['old_symbol', 'new_symbol', 'source_symbol', 'target_symbol', 'acquiree_symbol', 'acquirer_symbol'].map((key) => action.metadata[key])].filter((value): value is string => typeof value === 'string' && value.length > 0))];
}
