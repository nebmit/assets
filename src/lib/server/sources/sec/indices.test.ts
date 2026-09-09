import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { indexSources, parseIndexHoldings, resolveIndexCiks } from './indices.js';
import { parseSelection, secJobName, isScoped, filingScope } from './selection.js';
import { PgDialect } from 'drizzle-orm/pg-core';

const ivv = readFileSync('tests/fixtures/sec/ivv-holdings.csv', 'utf8');
const ijh = readFileSync('tests/fixtures/sec/ijh-holdings.csv', 'utf8');
describe('index universe', () => {
	it('parses both real CSV formats and excludes cash, futures, swaps and unlisted residuals', () => {
		expect(parseIndexHoldings(ivv, indexSources.sp500.name)).toEqual({ asOf: '2026-09-03', holdings: [
			{ ticker: 'NVDA', name: 'NVIDIA' }, { ticker: 'AAPL', name: 'APPLE' }, { ticker: 'MSFT', name: 'MICROSOFT' }
		] });
		expect(parseIndexHoldings(ijh, indexSources.sp400.name).holdings.map((h) => h.ticker)).toEqual(['TWLO', 'ILMN', 'FTI']);
	});
	it('rejects wrong funds, missing dates, schema drift, duplicate stocks and truncated rows', () => {
		expect(() => parseIndexHoldings(ivv, indexSources.sp400.name)).toThrow('Unexpected');
		expect(() => parseIndexHoldings(ivv.replace('Fund Holdings as of', 'Unknown'), indexSources.sp500.name)).toThrow('as-of');
		expect(() => parseIndexHoldings(ivv.replace('Sep 03, 2026', 'Feb 30, 2026'), indexSources.sp500.name)).toThrow('invalid calendar date');
		expect(() => parseIndexHoldings(ivv.replace('Asset Class', 'Asset'), indexSources.sp500.name)).toThrow('columns');
		expect(() => parseIndexHoldings(ivv.replace('"AAPL"', '"NVDA"'), indexSources.sp500.name)).toThrow('Duplicate');
		expect(() => parseIndexHoldings(ivv + '"BROKEN","row"\n', indexSources.sp500.name)).toThrow();
		expect(() => parseIndexHoldings('<html>Access denied</html>', indexSources.sp500.name)).toThrow();
	});
	it('normalizes space-separated share classes without joining distinct symbols', () => {
		const input = ijh.replace('"TWLO"', '"MOG A"').replace('"ILMN"', '"BRK B"');
		const parsed = parseIndexHoldings(input, indexSources.sp400.name);
		expect(parsed.holdings.map((h) => h.ticker)).toEqual(['MOG.A', 'BRK.B', 'FTI']);
		const resolved = resolveIndexCiks([{ index: 'sp400', holdings: parsed.holdings }], [
			{ ticker: 'MOG-A', cik: '0000067887', name: 'Moog', exchange: 'NYSE' },
			{ ticker: 'MOGA', cik: '0000000001', name: 'Different symbol', exchange: 'NYSE' }
		]);
		expect([...resolved.members.keys()]).toEqual(['0000067887']);
		expect(() => parseIndexHoldings(input.replace('"BRK B"', '"MOG.A"'), indexSources.sp400.name)).toThrow('Duplicate');
		expect(() => parseIndexHoldings(ijh.replace('"TWLO"', '"MOG A B"'), indexSources.sp400.name)).toThrow('Invalid equity holding ticker');
	});
	it('unions CIKs across share classes and indices, retaining unresolved and ambiguous symbols', () => {
		const holding = (ticker: string) => ({ ticker, name: ticker });
		const ticker = (symbol: string, cik: string) => ({ ticker: symbol, cik, name: symbol, exchange: 'NYSE' });
		const result = resolveIndexCiks([
			{ index: 'sp500', holdings: ['AAA', 'AAA.B', 'UNKNOWN', 'COLLISION'].map(holding) },
			{ index: 'sp400', holdings: ['AAA', 'BBB'].map(holding) }
		], [ticker('AAA', '0000000001'), ticker('AAA-B', '0000000001'), ticker('BBB', '0000000002'), ticker('COLLISION', '0000000003'), ticker('COLLISION', '0000000004')]);
		expect([...result.members.keys()]).toEqual(['0000000001', '0000000002']);
		expect([...result.members.get('0000000001')!]).toEqual(['sp500', 'sp400']);
		expect(result.unresolved).toEqual([{ index: 'sp500', ticker: 'UNKNOWN', reason: 'missing_cik' }, { index: 'sp500', ticker: 'COLLISION', reason: 'ambiguous_cik' }]);
	});
	it('defaults to both chosen indices and gives each scope its own checkpoint', () => {
		expect(parseSelection()).toEqual({ indices: ['sp400', 'sp500'] });
		expect(parseSelection('sp500,sp400,sp500')).toEqual(parseSelection());
		expect(parseSelection('all')).toEqual({ indices: null });
		for (const value of ['', 'sp600', 'all,sp500', 'sp500,']) expect(() => parseSelection(value)).toThrow('--indices');
		expect(secJobName('sec_filings', { issuerSelection: parseSelection() })).toBe('sec_filings:indices:sp400+sp500');
		expect(secJobName('sec_filings', { cik: '0000789019' })).toBe('sec_filings:0000789019');
		expect(secJobName('sec_filings', { issuerSelection: parseSelection('all') })).toBe('sec_filings');
	});
	it('fails closed on an empty selected cohort instead of draining the global backlog', () => {
		const scoped = { issuerSelection: parseSelection() };
		expect(isScoped(scoped)).toBe(true);
		const dialect = new PgDialect();
		expect(dialect.sqlToQuery(filingScope(scoped, [])!).sql).toBe('false');
		const query = dialect.sqlToQuery(filingScope(scoped, [12, 34])!);
		expect(query.sql).toContain('"source_filing"."issuer_id" in');
		expect(query.params).toEqual([12, 34]);
		expect(filingScope({ issuerSelection: parseSelection('all') }, [])).toBeUndefined();
	});
});
