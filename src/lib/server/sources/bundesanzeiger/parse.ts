import { parse } from 'csv-parse/sync';
import { md5 } from '../../util.js';

export const BUNDESANZEIGER_SOURCE = 'bundesanzeiger';

/**
 * Column headers of the register's CSV export (comma-separated, UTF-8 BOM,
 * every field double-quoted — unlike the semicolon-separated, unquoted BaFin
 * export). The header is asserted verbatim: a column rename or reorder must
 * fail the job rather than silently shift the data.
 */
const COLUMNS = {
	holder: 'Positionsinhaber',
	issuer: 'Emittent',
	isin: 'ISIN',
	position: 'Position',
	date: 'Datum'
} as const;

const EXPECTED_HEADER = Object.values(COLUMNS);

export interface ParsedShortPosition {
	holderNameRaw: string;
	issuerNameRaw: string;
	isin: string | null;
	/** Percent of issued share capital; < 0.5 means the position is closing. */
	positionPct: number;
	positionDate: string;
	naturalKeyHash: string;
	raw: Record<string, string>;
}

export interface ParsedShortPositions {
	/** Unique by naturalKeyHash. */
	rows: ParsedShortPosition[];
	unparseable: number;
	duplicatesCollapsed: number;
}

/**
 * "0,63" → 0.63, "1.234,56" → 1234.56. Deliberately strict: a dot-decimal
 * ("0.63") is rejected rather than read as 63, so a silent format switch by the
 * register surfaces as unparseable rows instead of corrupting every value.
 */
export function parseGermanNumber(input: string): number | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	if (!/^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^-?\d+(?:,\d+)?$/.test(trimmed)) return null;
	const value = Number(trimmed.replaceAll('.', '').replace(',', '.'));
	return Number.isFinite(value) ? value : null;
}

/** The register already publishes ISO dates — validated, never assumed. */
export function parseIsoDate(input: string): string | null {
	const trimmed = input.trim();
	const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return null;
	const [, year, month, day] = match;
	const date = new Date(`${trimmed}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return null;
	// reject overflow like 2026-13-01 / 2026-02-31, which Date would roll over
	if (
		date.getUTCFullYear() !== Number(year) ||
		date.getUTCMonth() + 1 !== Number(month) ||
		date.getUTCDate() !== Number(day)
	) {
		return null;
	}
	return trimmed;
}

/**
 * Parse a net-short-position CSV export.
 *
 * The dedupe key is a pure content hash — deliberately *not* the occurrence-index
 * trick used for the BaFin dealings export. Two reasons: we merge exports with
 * different scopes (a rolling historical window plus the open list) and vary the
 * window between runs, so occurrence indices would differ per file and mint
 * duplicates; and a dealing is a *flow* (two identical trades = twice the volume)
 * whereas a short position is a *state*, so two identical disclosures carry no
 * extra information and collapsing them is correct. Percentage is part of the
 * key, so genuine same-day revisions survive as separate rows, and the issuer
 * name is only used when the ISIN is absent so a rename cannot mint phantom rows.
 */
export function parseShortPositionsCsv(csvText: string): ParsedShortPositions {
	const records: Record<string, string>[] = parse(csvText, {
		delimiter: ',',
		bom: true,
		skip_empty_lines: true,
		trim: true,
		relax_column_count: true,
		columns: (header: string[]) => {
			const actual = header.join(',');
			const expected = EXPECTED_HEADER.join(',');
			if (actual !== expected) {
				throw new Error(
					`unexpected NLP CSV header: got "${actual.slice(0, 200)}", expected "${expected}"`
				);
			}
			return header;
		}
	});

	const byHash = new Map<string, ParsedShortPosition>();
	let unparseable = 0;
	let duplicatesCollapsed = 0;

	for (const record of records) {
		const positionPct = parseGermanNumber(record[COLUMNS.position] ?? '');
		const positionDate = parseIsoDate(record[COLUMNS.date] ?? '');
		const holderNameRaw = (record[COLUMNS.holder] ?? '').trim();
		const issuerNameRaw = (record[COLUMNS.issuer] ?? '').trim();
		if (positionPct === null || positionDate === null || !holderNameRaw || !issuerNameRaw) {
			unparseable++;
			continue;
		}
		const isin = (record[COLUMNS.isin] ?? '').trim() || null;

		const naturalKeyHash = md5(
			[
				BUNDESANZEIGER_SOURCE,
				holderNameRaw,
				isin ?? issuerNameRaw,
				positionDate,
				String(positionPct)
			].join('|')
		);
		if (byHash.has(naturalKeyHash)) {
			duplicatesCollapsed++;
			continue;
		}
		byHash.set(naturalKeyHash, {
			holderNameRaw,
			issuerNameRaw,
			isin,
			positionPct,
			positionDate,
			naturalKeyHash,
			raw: record
		});
	}

	return { rows: [...byHash.values()], unparseable, duplicatesCollapsed };
}
