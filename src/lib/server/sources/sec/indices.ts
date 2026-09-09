import { parse } from 'csv-parse/sync';
import { archiveEvidence, fetchSecText, type Evidence } from './client.js';
import { date, type parseTickers } from './parse.js';

export const indexSources: Record<string, { fund: string; name: string; url: string; expected: number }> = {
	sp500: { fund: 'IVV', name: 'iShares Core S&P 500 ETF', expected: 500,
		url: 'https://www.ishares.com/us/products/239726/ishares-core-s-p-500-etf/latest-holdings.csv' },
	sp400: { fund: 'IJH', name: 'iShares Core S&P Mid-Cap ETF', expected: 400,
		url: 'https://www.ishares.com/us/products/239763/ishares-core-s-p-mid-cap-etf/latest-holdings.csv' }
};
export interface IndexHolding { ticker: string; name: string }
export interface IndexSnapshot {
	index: string; fund: string; basis: 'etf_holdings_proxy'; asOf: string;
	holdings: IndexHolding[]; evidence: Evidence;
}

/** CSV preamble and non-stock positions are not constituents. Parse the table strictly. */
export function parseIndexHoldings(text: string, expectedFund: string): { asOf: string; holdings: IndexHolding[] } {
	const lines = text.replace(/^\uFEFF/, '').replaceAll('\r', '').split('\n');
	if (lines[0]?.trim() !== expectedFund) throw new Error('Unexpected index tracking fund');
	const heading = lines.findIndex((line) => line.startsWith('Ticker,Name,'));
	if (heading < 0) throw new Error('Missing holdings CSV header');
	const asOfLine = lines.slice(0, heading).find((line) => line.startsWith('Fund Holdings as of,'));
	if (!asOfLine) throw new Error('Missing holdings as-of date');
	const rawDate = (parse(asOfLine) as string[][])[0][1];
	const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2}), (\d{4})$/.exec(rawDate);
	if (!match) throw new Error('Invalid holdings as-of date');
	const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(match[1]) + 1;
	const asOf = date.parse(`${match[3]}-${String(month).padStart(2, '0')}-${match[2]}`);
	const rows = parse(lines.slice(heading).join('\n'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
	if (!rows.length || !['Asset Class', 'Exchange'].every((key) => key in rows[0])) throw new Error('Missing holdings classification columns');
	const holdings = new Map<string, IndexHolding>();
	for (const row of rows) {
		if (row['Asset Class'] !== 'Equity' || (row.Type !== undefined && row.Type !== 'EQUITY') || !['NASDAQ', 'NYSE', 'Nyse Mkt', 'Cboe BZX'].includes(row.Exchange)) continue;
		// iShares also renders share classes as "MOG A" / "BRK B". Keep the class separator.
		const ticker = row.Ticker?.trim().replace(/^([A-Z0-9]+)[ \t]+([A-Z])$/, '$1.$2'), name = row.Name?.trim();
		if (!ticker || !name || !/^[A-Z0-9]+(?:[.\-][A-Z0-9]+)?$/.test(ticker)) throw new Error(`Invalid equity holding ticker: ${ticker}`);
		if (holdings.has(ticker)) throw new Error(`Duplicate equity holding: ${ticker}`);
		holdings.set(ticker, { ticker, name });
	}
	if (!holdings.size) throw new Error('No equity holdings');
	return { asOf, holdings: [...holdings.values()] };
}

export async function fetchIndexSnapshots(indices: string[]): Promise<IndexSnapshot[]> {
	const snapshots: IndexSnapshot[] = [];
	for (const index of indices) {
		const source = indexSources[index];
		if (!source) throw new Error(`Unsupported index: ${index}`);
		const text = await fetchSecText(source.url, 2 * 1024 * 1024);
		const evidence = await archiveEvidence(source.url, text);
		const parsed = parseIndexHoldings(text, source.name);
		const age = Date.now() - Date.parse(parsed.asOf + 'T00:00:00Z');
		if (age < -86400000 || age > 10 * 86400000) throw new Error(`Stale or future ${index} holdings: ${parsed.asOf}; evidence ${evidence.path}`);
		if (parsed.holdings.length < source.expected * 0.9 || parsed.holdings.length > source.expected * 1.1) throw new Error(`Unexpected ${index} equity holding count: ${parsed.holdings.length}; evidence ${evidence.path}`);
		snapshots.push({ index, fund: source.fund, basis: 'etf_holdings_proxy', ...parsed, evidence });
	}
	return snapshots;
}

/** Only period/hyphen share-class separator conversion; ambiguous identities remain unresolved. */
export function resolveIndexCiks(snapshots: Pick<IndexSnapshot, 'index' | 'holdings'>[], tickers: ReturnType<typeof parseTickers>) {
	const bySymbol = new Map<string, Set<string>>();
	for (const row of tickers) {
		const symbol = row.ticker.replaceAll('.', '-');
		const ids = bySymbol.get(symbol) ?? new Set<string>(); ids.add(row.cik); bySymbol.set(symbol, ids);
	}
	const members = new Map<string, Set<string>>();
	const unresolved: { index: string; ticker: string; reason: string }[] = [];
	for (const snapshot of snapshots) for (const holding of snapshot.holdings) {
		const ids = bySymbol.get(holding.ticker.replaceAll('.', '-'));
		if (ids?.size !== 1) { unresolved.push({ index: snapshot.index, ticker: holding.ticker, reason: ids?.size ? 'ambiguous_cik' : 'missing_cik' }); continue; }
		const id = [...ids][0], indices = members.get(id) ?? new Set<string>();
		indices.add(snapshot.index); members.set(id, indices);
	}
	return { members, unresolved };
}
