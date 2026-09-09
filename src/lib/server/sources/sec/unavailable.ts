import { archiveEvidence, fetchSecText } from './client.js';
import { parseMasterIndex, parseSubmissions } from './parse.js';
import type { Filing } from './store.js';

/** A 404 alone is insufficient: both authoritative inventories must also omit the filing. */
export function absentFromInventories(filing: Pick<Filing, 'externalId' | 'filedDate'>, cik: string, index: string, submissions: unknown): boolean {
	const indexed = parseMasterIndex(index);
	const recent = parseSubmissions(submissions, cik).filings;
	const dates = recent.map((f) => f.filedDate).sort();
	return indexed.length > 0 && dates.length > 0 && dates[0] <= filing.filedDate && dates.at(-1)! >= filing.filedDate &&
		!indexed.some((f) => f.accession === filing.externalId) && !recent.some((f) => f.accession === filing.externalId);
}

export async function verifyUnavailableFiling(filing: Filing, cik: string) {
	const quarter = Math.floor((Number(filing.filedDate.slice(5, 7)) - 1) / 3) + 1;
	const indexUrl = `https://www.sec.gov/Archives/edgar/full-index/${filing.filedDate.slice(0, 4)}/QTR${quarter}/master.idx`;
	const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
	const index = await fetchSecText(indexUrl), submissions = await fetchSecText(submissionsUrl);
	if (!absentFromInventories(filing, cik, index, JSON.parse(submissions))) return null;
	return { version: 1, reason: 'archive_404_and_absent_from_current_inventories', verifiedAt: new Date().toISOString(),
		archiveUrl: filing.url, index: await archiveEvidence(indexUrl, index), submissions: await archiveEvidence(submissionsUrl, submissions) };
}
