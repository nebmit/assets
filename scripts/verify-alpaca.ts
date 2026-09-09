/** Read-only market-data verification; archives responses but does not mutate the database. */
import '../src/worker/env.js';
import { writeFile } from 'node:fs/promises';
import { alpacaRequest } from '../src/lib/server/sources/alpaca/client.js';
import { actionSymbols, parseActions, parseBars } from '../src/lib/server/sources/alpaca/parse.js';
import { addDays, isoDate } from '../src/lib/server/util.js';
import { subtractYears } from '../src/lib/date.js';
import { acceptanceTime } from '../src/lib/server/sources/sec/parse.js';
const symbols = ['AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'BRK.B', 'JPM', 'BAC', 'XOM', 'CVX', 'JNJ', 'PG', 'KO', 'WMT', 'COST', 'AVGO', 'ORCL', 'IBM'];
const through = addDays(isoDate(new Date(), 'America/New_York'), -1);
const evidence: unknown[] = [], bars: ReturnType<typeof parseBars>['rows'] = [], actions: ReturnType<typeof parseActions>['actions'] = [];
for (const kind of ['bars', 'actions'] as const) {
	let token: string | null = null; const seen = new Set<string>();
	do {
		const params: Record<string, string> = kind === 'bars'
			? { symbols: symbols.join(','), timeframe: '1Day', feed: 'sip', currency: 'USD', adjustment: 'raw', asof: through, start: subtractYears(through, 3), end: acceptanceTime(`${through}T23:59:59`), limit: '1000' }
			: { symbols: symbols.join(','), start: subtractYears(through, 4), end: through, limit: '100' };
		if (token) params.page_token = token;
		const response = await alpacaRequest(kind === 'bars' ? '/v2/stocks/bars' : '/v1/corporate-actions', params);
		evidence.push(response.evidence);
		if (kind === 'bars') { const page = parseBars(response.data, new Set(symbols), through); bars.push(...page.rows); token = page.next; }
		else { const page = parseActions(response.data); actions.push(...page.actions); token = page.next; }
		if (token && seen.has(token)) throw new Error('Repeated pagination token'); if (token) seen.add(token);
	} while (token);
}
const summary = symbols.map((symbol) => {
	const prices = bars.filter((b) => b.symbol === symbol).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
	return { symbol, bars: prices.length, firstDate: prices[0]?.tradeDate ?? null, latestDate: prices.at(-1)?.tradeDate ?? null, latestRawClose: prices.at(-1)?.close ?? null, actions: actions.filter((a) => actionSymbols(a).includes(symbol)).length };
});
const unmatchedActions = actions.filter((a) => !actionSymbols(a).some((symbol) => symbols.includes(symbol)));
const duplicates = bars.length - new Set(bars.map((b) => `${b.symbol}:${b.tradeDate}`)).size;
const result = { observedAt: new Date().toISOString(), through, feed: 'sip', currency: 'USD', adjustment: 'raw', issuerCount: 20, securities: summary, duplicates, unmatchedActions: unmatchedActions.map((a) => a.externalId), unqualifiedActions: actions.filter((a) => a.qualification !== 'qualified').map((a) => ({ symbol: a.symbol, type: a.type, exDate: a.exDate })), evidence };
await writeFile('docs/verification/alpaca-live.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ securities: symbols.length, bars: bars.length, actions: actions.length, pages: evidence.length, missing: summary.filter((s) => !s.bars).map((s) => s.symbol), duplicates }));
if (duplicates || unmatchedActions.length || summary.some((s) => !s.bars)) process.exitCode = 1;
