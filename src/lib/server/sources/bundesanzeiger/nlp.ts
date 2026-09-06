/**
 * Markup helpers for the Bundesanzeiger "Netto-Leerverkaufspositionen"
 * register. The portal is Apache Wicket: stateful, session-based, and every
 * link carries a page id that changes after each form POST. Nothing about the
 * component paths may be hardcoded — the CSV export link and the filter form
 * action are both read out of the rendered markup, and a rename fails loudly
 * rather than silently exporting the wrong thing.
 */

export const NLP_URL = 'https://www.bundesanzeiger.de/pub/de/nlp';

const NLP_HOST = 'www.bundesanzeiger.de';
const NLP_PATH = '/pub/de/nlp';

export const FILTER_FORM_FIELDS = [
	'fulltext',
	'positionsinhaber',
	// sic — the register's own typo for "emittent"; do not "fix" it
	'ermittent',
	'isin',
	'positionVon',
	'positionBis',
	'datumVon',
	'datumBis',
	'isHistorical'
] as const;

export interface NlpFilters {
	/** Include historised rows — i.e. the full change history, not just open positions. */
	historical: boolean;
	/** DD.MM.YYYY */
	dateFrom?: string;
	/** DD.MM.YYYY */
	dateTo?: string;
	isin?: string;
	holder?: string;
	issuerName?: string;
	positionFrom?: string;
	positionTo?: string;
}

function decodeEntities(value: string): string {
	return value
		.replaceAll('&amp;', '&')
		.replaceAll('&#38;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'");
}

function assertNlpUrl(candidate: string, what: string): string {
	let parsed: URL;
	try {
		parsed = new URL(candidate, NLP_URL);
	} catch {
		throw new Error(`${what} is not a valid URL: ${candidate.slice(0, 200)}`);
	}
	if (parsed.host !== NLP_HOST || parsed.pathname !== NLP_PATH) {
		throw new Error(`${what} points outside the NLP register: ${parsed.toString().slice(0, 200)}`);
	}
	return parsed.toString();
}

/**
 * The page renders the same export link above and below the results table; both
 * are equivalent, so the first wins.
 */
export function extractCsvExportUrl(html: string): string {
	const matches = [...html.matchAll(/href="([^"]*csv~resource~link[^"]*)"/g)];
	if (matches.length === 0) {
		throw new Error('csv export link not found in NLP markup — Wicket component path changed?');
	}
	return assertNlpUrl(decodeEntities(matches[0][1]), 'csv export link');
}

export function extractFilterFormAction(html: string): string {
	const match = html.match(/<form[^>]*class="search-form"[^>]*action="([^"]+)"/);
	if (!match) {
		throw new Error('NLP filter form not found in markup — Wicket component path changed?');
	}
	return assertNlpUrl(decodeEntities(match[1]), 'filter form action');
}

export function assertFilterFormFields(html: string, required: readonly string[]): void {
	const present = new Set(
		[...html.matchAll(/<(?:input|select|textarea)[^>]*\bname="([^"]+)"/g)].map((m) => m[1])
	);
	const missing = required.filter((field) => !present.has(field));
	if (missing.length > 0) {
		throw new Error(`NLP filter form is missing field(s): ${missing.join(', ')} — markup changed?`);
	}
}

/**
 * Every field is always sent — the portal expects the full form. `isHistorical`
 * is a checkbox, so it is omitted entirely rather than sent as `false`.
 */
export function buildSearchBody(filters: NlpFilters): string {
	const params = new URLSearchParams();
	params.set('fulltext', '');
	params.set('positionsinhaber', filters.holder ?? '');
	params.set('ermittent', filters.issuerName ?? '');
	params.set('isin', filters.isin ?? '');
	params.set('positionVon', filters.positionFrom ?? '');
	params.set('positionBis', filters.positionTo ?? '');
	params.set('datumVon', filters.dateFrom ?? '');
	params.set('datumBis', filters.dateTo ?? '');
	if (filters.historical) params.set('isHistorical', 'true');
	params.set('nlp-search-button', 'Leerverkäufe suchen');
	return params.toString();
}

/** Confirm the returned form represents an unfiltered open register. */
export function assertOpenScope(html: string): void {
	assertFilterFormFields(html, FILTER_FORM_FIELDS);
	for (const field of FILTER_FORM_FIELDS) {
		const input = [...html.matchAll(/<input\b[^>]*>/gi)].map((m) => m[0])
			.find((tag) => tag.match(/\bname="([^"]+)"/)?.[1] === field);
		if (!input) throw new Error(`NLP open scope cannot verify ${field}`);
		if (field === 'isHistorical') {
			if (/\schecked(?:\s|=|\/?>)/i.test(input)) throw new Error('NLP export is historical, not open');
		} else if ((input.match(/\bvalue="([^"]*)"/)?.[1] ?? '') !== '') {
			throw new Error(`NLP open export is filtered by ${field}`);
		}
	}
}
