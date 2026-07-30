import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGermanNumber, parseIsoDate, parseShortPositionsCsv } from './parse.js';

const fixture = readFileSync(
	new URL('../../../../../tests/fixtures/bundesanzeiger_nlp.csv', import.meta.url),
	'utf8'
);

describe('parseGermanNumber', () => {
	it('parses decimal comma and thousands dots', () => {
		expect(parseGermanNumber('0,63')).toBe(0.63);
		expect(parseGermanNumber('12,5')).toBe(12.5);
		expect(parseGermanNumber('1.234,56')).toBe(1234.56);
		expect(parseGermanNumber('5')).toBe(5);
	});

	it('rejects a dot-decimal rather than reading it as an integer', () => {
		expect(parseGermanNumber('0.63')).toBeNull();
	});

	it('returns null for empty or malformed input', () => {
		expect(parseGermanNumber('')).toBeNull();
		expect(parseGermanNumber('   ')).toBeNull();
		expect(parseGermanNumber('n/a')).toBeNull();
		expect(parseGermanNumber('0,63%')).toBeNull();
	});
});

describe('parseIsoDate', () => {
	it('accepts the ISO dates the register publishes', () => {
		expect(parseIsoDate('2026-07-28')).toBe('2026-07-28');
	});

	it('rejects German dates, overflow and empty input', () => {
		expect(parseIsoDate('28.07.2026')).toBeNull();
		expect(parseIsoDate('2026-13-01')).toBeNull();
		expect(parseIsoDate('2026-02-31')).toBeNull();
		expect(parseIsoDate('')).toBeNull();
	});
});

describe('parseShortPositionsCsv', () => {
	const parsed = parseShortPositionsCsv(fixture);

	it('strips the BOM and parses every usable row', () => {
		// 12 data rows: 1 duplicate collapsed, 1 unparseable (empty Position)
		expect(parsed.rows).toHaveLength(10);
		expect(parsed.duplicatesCollapsed).toBe(1);
		expect(parsed.unparseable).toBe(1);
		expect(parsed.rows[0]).toMatchObject({
			holderNameRaw: 'Marshall Wace LLP',
			issuerNameRaw: 'Bechtle Aktiengesellschaft',
			isin: 'DE0005158703',
			positionPct: 0.78,
			positionDate: '2026-07-28'
		});
	});

	it('throws on a changed header instead of shifting the columns', () => {
		const mutated = fixture.replace('"Position"', '"Netto-Position"');
		expect(() => parseShortPositionsCsv(mutated)).toThrow(/unexpected NLP CSV header/);
	});

	it('keeps sub-threshold rows — they are the implicit position closes', () => {
		const closing = parsed.rows.find((r) => r.isin === 'DE000A2YN900');
		expect(closing?.positionPct).toBe(0.42);
	});

	it('collapses byte-identical rows into one', () => {
		const cancom = parsed.rows.filter((r) => r.isin === 'DE0005419105');
		expect(cancom).toHaveLength(1);
	});

	it('keeps same-day revisions at a different percentage as separate rows', () => {
		const tag = parsed.rows.filter((r) => r.isin === 'DE0008303504');
		expect(tag).toHaveLength(2);
		expect(tag.map((r) => r.positionPct).sort()).toEqual([0.5, 0.61]);
		expect(new Set(tag.map((r) => r.naturalKeyHash)).size).toBe(2);
	});

	it('skips rows with an unusable position and counts them', () => {
		expect(parsed.rows.some((r) => r.holderNameRaw === 'Squarepoint Ops LLC')).toBe(false);
	});

	it('falls back to the issuer name in the key when the ISIN is missing', () => {
		const noIsin = parsed.rows.find((r) => r.issuerNameRaw === 'Beispiel Holding SE');
		expect(noIsin?.isin).toBeNull();
		expect(noIsin?.naturalKeyHash).toBeTruthy();
	});

	it('keeps out-of-universe rows', () => {
		expect(parsed.rows.some((r) => r.isin === 'IE00BW3G6L57')).toBe(true);
	});

	it('produces identical hashes when rows arrive in a different order', () => {
		// the property an occurrence-index key would fail: we merge a historical
		// window with the open list and vary the window between runs
		const [header, ...body] = fixture.trimEnd().split('\r\n');
		const shuffled = [header, ...body.slice().reverse()].join('\r\n');
		const reparsed = parseShortPositionsCsv(shuffled);
		expect(new Set(reparsed.rows.map((r) => r.naturalKeyHash))).toEqual(
			new Set(parsed.rows.map((r) => r.naturalKeyHash))
		);
	});

	it('retains the full source record in raw', () => {
		expect(parsed.rows[0].raw).toMatchObject({
			Positionsinhaber: 'Marshall Wace LLP',
			ISIN: 'DE0005158703',
			Position: '0,78'
		});
	});
});
