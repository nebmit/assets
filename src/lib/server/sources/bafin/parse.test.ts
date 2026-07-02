import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDealingsCsv, parseGermanAmount, parseGermanDate } from './parse.js';

const fixture = readFileSync(new URL('../../../../../tests/fixtures/bafin_dealings.csv', import.meta.url), 'utf8');

describe('parseGermanAmount', () => {
	it('parses thousands dots and decimal comma with currency', () => {
		expect(parseGermanAmount('61.240,87 EUR')).toEqual({ value: 61240.87, currency: 'EUR' });
		expect(parseGermanAmount('14,95 USD')).toEqual({ value: 14.95, currency: 'USD' });
		expect(parseGermanAmount('8.721.610,20 EUR')).toEqual({ value: 8721610.2, currency: 'EUR' });
	});
	it('returns null for empty or malformed input', () => {
		expect(parseGermanAmount('')).toBeNull();
		expect(parseGermanAmount('n/a')).toBeNull();
	});
});

describe('parseGermanDate', () => {
	it('parses dates with and without time', () => {
		expect(parseGermanDate('30.06.2026')).toBe('2026-06-30');
		expect(parseGermanDate('01.07.2026 09:49:22')).toBe('2026-07-01');
		expect(parseGermanDate('')).toBeNull();
	});
});

describe('parseDealingsCsv', () => {
	const rows = parseDealingsCsv(fixture);

	it('parses every data row including unquoted fields with literal quotes', () => {
		expect(rows).toHaveLength(7);
		const quoted = rows.find((r) => r.isin === 'DE000A161077');
		expect(quoted?.partyName).toBe('MS "CORDULA" Schiffahrtsgesellschaft mbH & Co. KG');
		expect(quoted?.side).toBe('sell');
		expect(quoted?.amount).toBe(8721610.2);
	});

	it('maps role and side vocabularies', () => {
		const bySide = Object.groupBy(rows, (r) => r.side);
		expect(bySide.buy).toHaveLength(2);
		expect(bySide.sell).toHaveLength(1);
		expect(bySide.other).toHaveLength(4);
		expect(rows.find((r) => r.partyName.startsWith('Zachert'))?.partyRole).toBe('executive_board');
		expect(rows.find((r) => r.partyName.startsWith('Muster'))?.partyRole).toBe('supervisory_board');
		expect(rows.find((r) => r.partyName.startsWith('Glingener'))?.partyRole).toBe('other');
	});

	it('uses activation date as publishedDate and keeps transaction date', () => {
		const leg = rows.find((r) => r.isin === 'DE000LEG1110');
		expect(leg?.transactionDate).toBe('2026-06-30');
		expect(leg?.publishedDate).toBe('2026-07-01');
	});

	it('handles empty price/amount and foreign currency', () => {
		const elmos = rows.filter((r) => r.isin === 'DE0005677108');
		expect(elmos[0].price).toBeNull();
		expect(elmos[0].amount).toBeNull();
		expect(rows.find((r) => r.isin === 'US00486H1059')?.currency).toBe('USD');
	});

	it('gives identical rows distinct, stable dedupe hashes', () => {
		const elmos = rows.filter((r) => r.isin === 'DE0005677108');
		expect(elmos).toHaveLength(2);
		expect(elmos[0].naturalKeyHash).not.toBe(elmos[1].naturalKeyHash);
		// stable across re-parses of the same export
		const again = parseDealingsCsv(fixture).filter((r) => r.isin === 'DE0005677108');
		expect(again.map((r) => r.naturalKeyHash)).toEqual(elmos.map((r) => r.naturalKeyHash));
	});
});
