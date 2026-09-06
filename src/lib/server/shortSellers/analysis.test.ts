import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeShortSellers, validateOpenExport, type PositionSnapshot } from './analysis.js';
import { parseShortPositionsCsv, type ParsedShortPosition } from '../sources/bundesanzeiger/parse.js';
import { assertOpenScope, FILTER_FORM_FIELDS } from '../sources/bundesanzeiger/nlp.js';
import { parseShortSellerRationale } from './rationale.js';

const identities = [{ isin: 'DE0005158703', issuerId: 1 }, { isin: 'DE0005419105', issuerId: 2 }];
const row = (overrides: Partial<ParsedShortPosition> = {}): ParsedShortPosition => ({
	holderNameRaw: 'Holder A', issuerNameRaw: 'Issuer', isin: identities[0].isin,
	positionPct: 0.5, positionDate: '2020-01-01', naturalKeyHash: 'a', raw: {}, ...overrides
});
const snapshot = (rows: ParsedShortPosition[]): PositionSnapshot => ({
	id: 1, capturedAt: new Date('2026-09-04T22:30:00Z'), rows,
	diagnostics: validateOpenExport({ rows, unparseable: 0, duplicatesCollapsed: 0 }, new Date('2026-09-05T08:00:00Z'))
});
const analyze = (rows: ParsedShortPosition[]) => analyzeShortSellers(snapshot(rows), identities, '2026-09-05');

describe('short seller analysis', () => {
	it('includes 0.5%, deduplicates, orders holders and sums only their latest positions', () => {
		const result = analyze([row(), row(), row({ holderNameRaw: 'B', positionPct: 1.2 }),
			row({ holderNameRaw: 'B', positionPct: 0.8, positionDate: '2026-01-01' })]);
		expect(result.get(1)).toMatchObject({ status: 'present', freshness: 'fresh', holderCount: 2, totalDisclosedPct: 1.3 });
		expect(result.get(1)?.holders.map((h) => h.holderName)).toEqual(['B', 'Holder A']);
		expect(result.get(2)).toMatchObject({ status: 'none_disclosed', holderCount: 0, totalDisclosedPct: 0 });
	});
	it('a sub-threshold exit removes an older position', () => {
		expect(analyze([row(), row({ positionPct: 0.49, positionDate: '2026-09-01' })]).get(1)?.status).toBe('none_disclosed');
	});
	it('conflicting latest values are unknown regardless of input ordering', () => {
		const rows = [row(), row({ positionPct: 0.4 })];
		for (const input of [rows, [...rows].reverse()]) {
			expect(analyze(input).get(1)).toMatchObject({ status: 'unknown', totalDisclosedPct: null, holderCount: null });
		}
	});
	it('missing identity prevents absence but foreign ISINs do not', () => {
		expect(analyze([row({ isin: null })]).get(2)?.status).toBe('unknown');
		expect(analyze([row({ isin: 'invalid' })]).get(2)?.status).toBe('unknown');
		expect(analyze([row({ isin: 'IE00BW3G6L57' })]).get(2)?.status).toBe('none_disclosed');
	});
	it('keeps identified presence with null totals when identity coverage is incomplete', () => {
		expect(analyze([row(), row({ isin: null })]).get(1)).toMatchObject({ status: 'present', totalDisclosedPct: null });
	});
	it('groups different instrument ISINs of the same issuer without duplicating a holder', () => {
		const result = analyzeShortSellers(snapshot([row(), row({ isin: identities[1].isin })]),
			identities.map((i) => ({ ...i, issuerId: 1 })), '2026-09-05');
		expect(result.get(1)?.holderCount).toBe(1);
	});
	it('uses Berlin observation day, allows three days, and preserves stale details', () => {
		const s = snapshot([row()]);
		expect(analyzeShortSellers(s, identities, '2026-09-04').get(1)?.status).toBe('unknown');
		expect(analyzeShortSellers(s, identities, '2026-09-08').get(1)?.freshness).toBe('fresh');
		expect(analyzeShortSellers(s, identities, '2026-09-09').get(1)).toMatchObject({ freshness: 'stale', holderCount: 1 });
		expect(analyzeShortSellers(null, identities, '2026-09-05').get(1)?.snapshotId).toBeNull();
	});
});

describe('snapshot trust boundary', () => {
	it('accepts trimmed real register fixtures', () => {
		const base = '../../../../tests/fixtures/';
		const form = readFileSync(new URL(`${base}bundesanzeiger_open_form.html`, import.meta.url), 'utf8');
		const csv = readFileSync(new URL(`${base}bundesanzeiger_open.csv`, import.meta.url), 'utf8');
		expect(() => assertOpenScope(form)).not.toThrow();
		const parsed = parseShortPositionsCsv(csv, true);
		expect(parsed.rows).toHaveLength(6);
		expect(validateOpenExport(parsed, new Date('2026-09-05T06:00:00Z')).complete).toBe(true);
	});
	it('rejects empty, partly parsed, invalid percentage and future exports', () => {
		const captured = new Date('2026-09-05T08:00:00Z');
		for (const parsed of [
			{ rows: [], unparseable: 0 }, { rows: [row()], unparseable: 1 },
			...[NaN, -1, 101].map((positionPct) => ({ rows: [row({ positionPct })], unparseable: 0 })),
			{ rows: [row({ positionDate: '2026-09-06' })], unparseable: 0 }
		]) expect(() => validateOpenExport({ ...parsed, duplicatesCollapsed: 0 }, captured)).toThrow();
	});
	it('rejects malformed column counts in snapshot exports', () => {
		expect(() => parseShortPositionsCsv('"Positionsinhaber","Emittent","ISIN","Position","Datum"\n"A","B","DE0005158703","0,5","2026-09-01","extra"', true)).toThrow();
	});
	it('verifies a full open scope and rejects filters, history and missing fields', () => {
		const form = FILTER_FORM_FIELDS.map((name) => `<input name="${name}" value="">`).join('');
		expect(() => assertOpenScope(form)).not.toThrow();
		expect(() => assertOpenScope(form.replace('name="isin" value=""', 'name="isin" value="DE0005158703"'))).toThrow();
		expect(() => assertOpenScope(form.replace('name="isHistorical"', 'name="isHistorical" checked'))).toThrow();
		expect(() => assertOpenScope(form.replace('name="fulltext"', 'name="changed"'))).toThrow();
	});
	it('legacy or malformed rationale degrades to unknown', () => {
		for (const raw of [null, {}, { shortSellers: { status: 'none_disclosed' } }]) {
			expect(parseShortSellerRationale(raw).status).toBe('unknown');
		}
		const shortSellers = analyze([row()]).get(1);
		expect(parseShortSellerRationale({ shortSellers })).toEqual(shortSellers);
	});
});
