import { acceptanceTime } from './parse.js';

/** Financial/news ingestion needs only the submission header, not exhibits or report text. */
export function parseFinancialHeader(header: string, accession: string): Date | null {
	if (!/<SEC-DOCUMENT>/i.test(header) || !/<SEC-HEADER>[\s\S]*<\/SEC-HEADER>/i.test(header)) throw new Error('invalid complete SEC submission header');
	const headerAcc = /ACCESSION NUMBER:\s*(\d{10}-\d{2}-\d{6})/.exec(header)?.[1];
	if (headerAcc !== accession) throw new Error('filing accession mismatch');
	const time = /<ACCEPTANCE-DATETIME>(\d{14})/.exec(header)?.[1];
	if (header.includes('<ACCEPTANCE-DATETIME>') && !time) throw new Error('invalid acceptance timestamp');
	return time ? new Date(acceptanceTime(time)) : null;
}
