import { z } from 'zod';

export function cik(value: unknown): string {
	const text = String(value);
	if (!/^\d{1,10}$/.test(text) || Number(text) === 0) throw new Error(`invalid CIK: ${text}`);
	return text.padStart(10, '0');
}
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
	const d = new Date(v); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'invalid calendar date');
export const accession = z.string().regex(/^\d{10}-\d{2}-\d{6}$/);
export const ownershipForm = /^(3|4|5)(\/A)?$/;
export const financialForm = /^(10-K|10-Q)(\/A)?$/;
export const evidenceForm = /^(10-K|10-Q|8-K|3|4|5)(\/A)?$/;
export interface FilingRecord {
	accession: string; form: string; filedDate: string; reportDate?: string;
	acceptedAt?: string; url: string; cik: string; primaryDocument?: string; items?: string;
}

/** SGML timestamps are Eastern wall times; submissions timestamps with offsets are respected. */
export function acceptanceTime(value: string): string {
	if (/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
		const d = new Date(value); if (!Number.isFinite(d.getTime())) throw new Error('invalid acceptance timestamp'); return d.toISOString();
	}
	const digits = value.replace(/[- :T]/g, '');
	if (!/^\d{14}$/.test(digits)) throw new Error('invalid acceptance timestamp');
	const iso = `${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}T${digits.slice(8,10)}:${digits.slice(10,12)}:${digits.slice(12,14)}`;
	date.parse(iso.slice(0,10));
	const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
	for (const offset of ['-05:00', '-04:00']) {
		const d = new Date(iso + offset);
		if (Number.isFinite(d.getTime()) && formatter.format(d).replace(' ', 'T') === iso) return d.toISOString();
	}
	throw new Error('nonexistent Eastern acceptance timestamp');
}

export function parseSubmissions(input: unknown, issuerCik: string): { filings: FilingRecord[]; files: { name: string; filingFrom: string; filingTo: string }[]; metadata: Record<string, unknown> } {
	const obj = z.record(z.unknown()).parse(input);
	if (obj.cik !== undefined && cik(obj.cik) !== issuerCik) throw new Error('submissions CIK mismatch');
	const container = obj.filings ? z.record(z.unknown()).parse(obj.filings) : null;
	const recent = z.record(z.array(z.unknown())).parse(container ? container.recent : obj);
	const n = recent.accessionNumber?.length;
	if (n === undefined || !recent.form || !recent.filingDate) throw new Error('missing submissions columns');
	for (const values of Object.values(recent)) if (values.length !== n) throw new Error('unequal submissions column lengths');
	const filings: FilingRecord[] = [];
	for (let i = 0; i < n; i++) {
		const acc = accession.parse(recent.accessionNumber[i]);
		const form = z.string().parse(recent.form[i]);
		if (!evidenceForm.test(form)) continue;
		const primary = recent.primaryDocument?.[i];
		const accepted = recent.acceptanceDateTime?.[i];
		filings.push({ accession: acc, form, cik: issuerCik, filedDate: date.parse(recent.filingDate[i]),
			reportDate: recent.reportDate?.[i] ? date.parse(recent.reportDate[i]) : undefined,
			acceptedAt: accepted ? acceptanceTime(String(accepted)) : undefined,
			primaryDocument: typeof primary === 'string' ? primary : undefined,
			items: typeof recent.items?.[i] === 'string' ? recent.items[i] as string : undefined,
			url: `https://www.sec.gov/Archives/edgar/data/${Number(issuerCik)}/${acc.replaceAll('-', '')}/${acc}.txt`
		});
	}
	const files = container ? z.array(z.object({ name: z.string().regex(/^CIK\d{10}-submissions-\d+\.json$/), filingFrom: date, filingTo: date })).parse(container.files ?? []) : [];
	const { filings: ignored, ...metadata } = obj;
	return { filings, files, metadata: container ? metadata : {} };
}

export function parseMasterIndex(text: string): FilingRecord[] {
	const lines = text.replaceAll('\r', '').split('\n');
	const start = lines.findIndex((line) =>
		line.split('|').map((field) => field.replace(/\s/g, '').toLowerCase()).join('|') ===
		'cik|companyname|formtype|datefiled|filename'
	);
	if (start < 0) throw new Error('missing EDGAR master index header');
	const result: FilingRecord[] = [];
	for (const line of lines.slice(start + 1)) {
		if (!line.trim() || /^-+$/.test(line)) continue;
		const fields = line.split('|').map((field) => field.trim()); if (fields.length !== 5) throw new Error('malformed master index row');
		const [id, , form, filed, filename] = fields;
		const match = /^edgar\/data\/\d+\/(\d{10}-\d{2}-\d{6})\.txt$/.exec(filename);
		if (!match) throw new Error('invalid filing archive path');
		if (evidenceForm.test(form)) result.push({ cik: cik(id), accession: accession.parse(match[1]), form, filedDate: date.parse(filed.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')), url: `https://www.sec.gov/Archives/${filename}` });
	}
	return result;
}

export interface Listing { symbol: string; name: string; exchange: string; excludedReason: string | null }
export function parseDirectory(text: string): Listing[] {
	const lines = text.trim().replaceAll('\r', '').split('\n');
	const headers = lines.shift()!.split('|');
	const symbolField = headers.includes('Symbol') ? 'Symbol' : 'ACT Symbol';
	if (!headers.includes(symbolField) || !headers.includes('Security Name') || !headers.includes('Test Issue') || !headers.includes('ETF')) throw new Error('invalid symbol directory header');
	if (!lines.some((l) => l.startsWith('File Creation Time:'))) throw new Error('missing symbol directory footer');
	return lines.filter((l) => l && !l.startsWith('File Creation Time:')).map((line) => {
		const values = line.split('|'); if (values.length !== headers.length) throw new Error('malformed listing row');
		const r = Object.fromEntries(headers.map((h, i) => [h, values[i]]));
		const name = r['Security Name'];
		const reason = r['Test Issue'] === 'Y' ? 'test_issue' : r.ETF === 'Y' ? 'etf' :
			/\b(preferred|depositary|deposit[ao]ry|warrants?|rights|units|notes|bonds|debentures|fund|ETF|ETN)\b/i.test(name) ? 'excluded_security_type' : null;
		return { symbol: r[symbolField], name, exchange: r.Exchange ?? 'Q', excludedReason: reason };
	});
}
export function parseTickers(input: unknown): { cik: string; name: string; ticker: string; exchange: string | null }[] {
	const obj = z.object({ fields: z.array(z.string()), data: z.array(z.array(z.unknown())) }).parse(input);
	for (const f of ['cik','name','ticker','exchange']) if (!obj.fields.includes(f)) throw new Error('missing ticker field');
	return obj.data.map((values) => {
		if (values.length !== obj.fields.length) throw new Error('malformed ticker row');
		const row = Object.fromEntries(obj.fields.map((f, i) => [f, values[i]]));
		return { cik: cik(row.cik), name: z.string().parse(row.name), ticker: z.string().parse(row.ticker), exchange: z.string().nullable().parse(row.exchange) };
	});
}

export function classifyIssuer(metadata: Record<string, unknown>, listings: Listing[], forms: string[]): { status: 'included' | 'excluded' | 'pending'; reason: string } {
	if (listings.length === 0) return { status: 'pending', reason: 'no_directory_match' };
	if (listings.every((l) => l.excludedReason)) return { status: 'excluded', reason: 'excluded_security_type' };
	if (metadata.entityType && !['operating', 'other'].includes(String(metadata.entityType))) return { status: 'excluded', reason: 'non_operating_entity' };
	const latestPeriodicForm = forms.find((f) => /^(10-K|10-Q|20-F|40-F)(\/A)?$/.test(f));
	if (latestPeriodicForm && /^(20-F|40-F)/.test(latestPeriodicForm)) return { status: 'excluded', reason: 'foreign_private_issuer' };
	if (!forms.some((f) => /^(10-K|10-Q)(\/A)?$/.test(f))) return { status: 'pending', reason: 'domestic_reporting_unconfirmed' };
	if (listings.some((l) => !l.excludedReason && !/\b(common|ordinary|class [a-z]|shares of beneficial interest)\b/i.test(l.name))) return { status: 'pending', reason: 'security_class_unconfirmed' };
	return { status: 'included', reason: 'domestic_reporting_and_listed_common_equity' };
}

/** The quarterly ownership dataset uses tab-separated rows and DD-MON-YYYY dates. */
export function parseInsiderDataset(text: string): { accession: string; cik: string; form: string; filedDate: string }[] {
	const lines = text.trim().replaceAll('\r','').split('\n');
	const headers = lines.shift()!.split('\t');
	for (const field of ['ACCESSION_NUMBER','ISSUERCIK','DOCUMENT_TYPE','FILING_DATE']) if (!headers.includes(field)) throw new Error('unknown insider dataset columns');
	const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
	return lines.map((line) => {
		const values = line.split('\t'); if (values.length !== headers.length) throw new Error('malformed insider dataset row');
		const row = Object.fromEntries(headers.map((h,i) => [h,values[i]]));
		const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/i.exec(row.FILING_DATE);
		const filedDate = date.parse(m ? `${m[3]}-${String(months.indexOf(m[2].toUpperCase())+1).padStart(2,'0')}-${m[1]}` : row.FILING_DATE);
		if (!ownershipForm.test(row.DOCUMENT_TYPE)) throw new Error('unknown ownership dataset form');
		return { accession: accession.parse(row.ACCESSION_NUMBER), cik: cik(row.ISSUERCIK), form: row.DOCUMENT_TYPE, filedDate };
	});
}
