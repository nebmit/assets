import { parse } from 'csv-parse/sync';
import { md5 } from '../../util.js';

export const BAFIN_SOURCE = 'bafin';

/** Column headers of the DealingsInfo CSV export (semicolon-separated, UTF-8 BOM). */
const COLUMNS = {
	issuer: 'Emittent',
	bafinId: 'BaFin-ID',
	isin: 'ISIN',
	party: 'Meldepflichtiger',
	role: 'Position / Status',
	instrumentType: 'Art des Instruments',
	side: 'Art des Geschäfts',
	price: 'Durchschnittspreis',
	volume: 'Aggregiertes Volumen',
	notificationDate: 'Mitteilungsdatum',
	transactionDate: 'Datum des Geschäfts',
	venue: 'Ort des Geschäfts',
	activationDate: 'Datum der Aktivierung'
} as const;

const ROLE_MAP: Record<string, 'executive_board' | 'supervisory_board' | 'related_party' | 'other'> = {
	Vorstand: 'executive_board',
	Aufsichtsrat: 'supervisory_board',
	'in enger Beziehung': 'related_party',
	'Sonstige Führungsperson': 'other'
};

const SIDE_MAP: Record<string, 'buy' | 'sell' | 'other'> = {
	Kauf: 'buy',
	Verkauf: 'sell',
	Sonstiges: 'other'
};

export interface ParsedDealing {
	issuerNameRaw: string;
	isin: string | null;
	partyName: string;
	partyRole: 'executive_board' | 'supervisory_board' | 'related_party' | 'other';
	side: 'buy' | 'sell' | 'other';
	instrumentType: string | null;
	price: number | null;
	amount: number | null;
	currency: string | null;
	transactionDate: string;
	publishedDate: string;
	venue: string | null;
	naturalKeyHash: string;
	raw: Record<string, string>;
}

/** "61.240,87 EUR" → { value: 61240.87, currency: 'EUR' } */
export function parseGermanAmount(input: string): { value: number; currency: string | null } | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const match = trimmed.match(/^(-?[\d.]+(?:,\d+)?)(?:\s+([A-Z]{3}))?$/);
	if (!match) return null;
	const value = Number(match[1].replaceAll('.', '').replace(',', '.'));
	if (!Number.isFinite(value)) return null;
	return { value, currency: match[2] ?? null };
}

/** "30.06.2026" (optionally with time) → "2026-06-30" */
export function parseGermanDate(input: string): string | null {
	const match = input.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})/);
	if (!match) return null;
	return `${match[3]}-${match[2]}-${match[1]}`;
}

/**
 * Parse the DealingsInfo CSV export. Identical rows occur legitimately
 * (e.g. two equal transactions on the same day), so the dedupe hash includes
 * an occurrence index within the file — stable because the export is always
 * the full rolling window.
 */
export function parseDealingsCsv(csvText: string): ParsedDealing[] {
	const records: Record<string, string>[] = parse(csvText, {
		delimiter: ';',
		bom: true,
		columns: true,
		skip_empty_lines: true,
		trim: true,
		relax_column_count: true,
		// the export never quotes fields, but names may contain literal quotes
		quote: null
	});

	const occurrences = new Map<string, number>();
	const result: ParsedDealing[] = [];
	for (const record of records) {
		const transactionDate = parseGermanDate(record[COLUMNS.transactionDate] ?? '');
		if (!transactionDate) continue; // unusable without a transaction date
		const publishedDate =
			parseGermanDate(record[COLUMNS.activationDate] ?? '') ??
			parseGermanDate(record[COLUMNS.notificationDate] ?? '') ??
			transactionDate;

		const rowFingerprint = Object.values(COLUMNS)
			.map((column) => record[column] ?? '')
			.join(';');
		const occurrence = (occurrences.get(rowFingerprint) ?? 0) + 1;
		occurrences.set(rowFingerprint, occurrence);

		const price = parseGermanAmount(record[COLUMNS.price] ?? '');
		const amount = parseGermanAmount(record[COLUMNS.volume] ?? '');
		result.push({
			issuerNameRaw: record[COLUMNS.issuer] ?? '',
			isin: record[COLUMNS.isin] || null,
			partyName: record[COLUMNS.party] ?? '',
			partyRole: ROLE_MAP[record[COLUMNS.role] ?? ''] ?? 'other',
			side: SIDE_MAP[record[COLUMNS.side] ?? ''] ?? 'other',
			instrumentType: record[COLUMNS.instrumentType] || null,
			price: price?.value ?? null,
			amount: amount?.value ?? null,
			currency: amount?.currency ?? price?.currency ?? null,
			transactionDate,
			publishedDate,
			venue: record[COLUMNS.venue] || null,
			naturalKeyHash: md5(`${rowFingerprint}#${occurrence}`),
			raw: record
		});
	}
	return result;
}
