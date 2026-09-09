import { describe, expect, it } from 'vitest';
import { acceptanceTime, cik, classifyIssuer, parseDirectory, parseMasterIndex, parseInsiderDataset, parseSubmissions, parseTickers } from './parse.js';
import { normalizeFacts } from './facts.js';
import { parseOwnership } from './ownership.js';
import { readFileSync } from 'node:fs';
import { retryDelay } from './client.js';

const ownership = readFileSync('tests/fixtures/sec/msft-form4.txt','utf8');
const acc = '0000789019-26-000141';
const subs = { cik: 789019, name: 'MICROSOFT CORP', filings: { recent: {
	accessionNumber: [acc], form: ['4'], filingDate: ['2026-08-05'], reportDate: ['2026-08-04'], primaryDocument: ['xslF345X05/form4.xml'], acceptanceDateTime: ['2026-08-05T22:08:55.000Z']
}, files: [{ name: 'CIK0000789019-submissions-001.json', filingFrom: '2020-01-01', filingTo: '2025-01-01' }] } };

describe('SEC discovery', () => {
	it('parses the real daily master header and compact filing dates', () => {
		const source = readFileSync('tests/fixtures/sec/master-20250905.idx','utf8');
		const rows = parseMasterIndex(source);
		expect(rows.length).toBeGreaterThan(0);
		expect(rows[0]).toMatchObject({ cik:'0001000045', form:'4', filedDate:'2025-09-05', accession:'0001903601-25-000081' });
		expect(rows.every((row)=>row.filedDate === '2025-09-05')).toBe(true);
		expect(rows.some((row)=>row.form === 'CORRESP')).toBe(false);
		expect(() => parseMasterIndex(source.replaceAll('20250905','20250230'))).toThrow('invalid calendar date');
		expect(() => parseMasterIndex(source.replace('Date Filed','Unexpected Column'))).toThrow('header');
	});
	it('normalizes CIK without confusing issuer and accession prefixes', () => {
		expect(cik(789019)).toBe('0000789019'); expect(() => cik(0)).toThrow(); expect(() => cik('../42')).toThrow();
		const text = 'Description\nCIK|Company Name|Form Type|Date Filed|Filename\n-----\n1899931|Owner|4|2026-08-05|edgar/data/789019/0000789019-26-000141.txt\n';
		const [f] = parseMasterIndex(text); expect(f.cik).toBe('0001899931'); expect(f.url).toContain('/789019/');
		expect(() => parseMasterIndex('<html>challenge</html>')).toThrow();
		expect(() => parseMasterIndex(text.replace('|4|','|4|extra|'))).toThrow();
	});
	it('reads recent and historical column arrays, fails on malformed columns', () => {
		const parsed = parseSubmissions(subs,'0000789019'); expect(parsed.files).toHaveLength(1); expect(parsed.filings[0].primaryDocument).toContain('xsl');
		expect(parseSubmissions(subs.filings.recent,'0000789019').filings).toHaveLength(1);
		const bad = structuredClone(subs); bad.filings.recent.form = []; expect(() => parseSubmissions(bad,'0000789019')).toThrow('unequal');
		expect(() => parseSubmissions(subs,'0000320193')).toThrow('mismatch');
	});
	it('validates directory footer and classifies common equity conservatively', () => {
		const text = 'Symbol|Security Name|Test Issue|ETF\nMSFT|Microsoft - Common Stock|N|N\nETF|Example Fund|N|Y\nFile Creation Time: 09062026|||';
		const listings = parseDirectory(text); expect(listings[1].excludedReason).toBe('etf');
		expect(classifyIssuer({entityType:'operating'},[listings[0]],['10-K']).status).toBe('included');
		expect(classifyIssuer({},[listings[0]],['20-F']).status).toBe('excluded');
		expect(classifyIssuer({},[listings[0]],[]).status).toBe('pending');
		expect(() => parseDirectory(text.split('File Creation')[0])).toThrow('footer');
		expect(parseTickers({fields:['cik','name','ticker','exchange'],data:[[789019,'Microsoft','MSFT','Nasdaq']]})).toHaveLength(1);
	});
	it('converts Eastern headers with DST, respecting explicit offsets', () => {
		expect(acceptanceTime('20260805180855')).toBe('2026-08-05T22:08:55.000Z');
		expect(acceptanceTime('20260105180855')).toBe('2026-01-05T23:08:55.000Z');
		expect(acceptanceTime('2026-08-05T22:08:55Z')).toBe('2026-08-05T22:08:55.000Z');
		expect(() => acceptanceTime('20260308023000')).toThrow();
	});
	it('reads the quarterly insider dataset with original filing dates', () => {
		const rows = parseInsiderDataset('ACCESSION_NUMBER\tISSUERCIK\tDOCUMENT_TYPE\tFILING_DATE\n0000789019-26-000141\t789019\t4\t05-AUG-2026');
		expect(rows[0]).toMatchObject({cik:'0000789019',form:'4',filedDate:'2026-08-05'});
		expect(() => parseInsiderDataset('ACCESSION_NUMBER\nwrong')).toThrow();
	});
	it('does not shorten server cooldowns', () => {
		expect(retryDelay('120',0)).toBe(120000);
		expect(retryDelay('Sun, 06 Sep 2026 12:01:00 GMT',0,Date.parse('2026-09-06T12:00:00Z'))).toBe(60000);
	});
});

describe('SEC ownership', () => {
	it.each([
		['0001654954-26-004735', ['2026-05-12']],
		['0001654954-26-004635', ['2026-05-07', '2026-05-07']]
	])('accepts timezone-qualified dates in real PTC filing %s', (accession, dates) => {
		const source = readFileSync(`tests/fixtures/sec/ptc-${accession}.xml`, 'utf8');
		const parsed = parseOwnership(source, accession, 'h');
		expect(parsed.transactions.map((t) => t.transactionDate)).toEqual(dates);
		expect(JSON.stringify(parsed.transactions[0].raw.row)).toContain(`${dates[0]}-05:00`);
	});
	it.each(['Z', '+14:00', '-14:00', '+05:30'])('retains calendar dates with XML timezone %s', (suffix) => {
		const source = readFileSync('tests/fixtures/sec/ptc-0001654954-26-004735.xml', 'utf8')
			.replaceAll('2026-05-12-05:00', `2026-05-12${suffix}`)
			.replace('<documentType>4</documentType>', `<documentType>4/A</documentType><dateOfOriginalSubmission>2026-05-11${suffix}</dateOfOriginalSubmission>`);
		const parsed = parseOwnership(source, acc, 'h');
		expect(parsed.transactions[0].transactionDate).toBe('2026-05-12');
		expect(parsed.originalSubmissionDate).toBe('2026-05-11');
	});
	it.each(['2026-02-30-05:00', '2026-05-12+14:01', '2026-05-12-15:00', '2026-05-12+05:60', '2026-05-12junk'])('rejects invalid ownership date %s', (value) => {
		const source = readFileSync('tests/fixtures/sec/ptc-0001654954-26-004735.xml', 'utf8').replaceAll('2026-05-12-05:00', value);
		expect(() => parseOwnership(source, acc, 'h')).toThrow();
	});
	it('accepts real leading-dot fractional shares without dropping the filing', () => {
		const parsed = parseOwnership(readFileSync('tests/fixtures/sec/d-form4-fraction.txt', 'utf8'), '0000029534-26-000070', 'h');
		expect(parsed.transactions[1]).toMatchObject({ volume: '0.3258', price: '109.9' });
	});
	it('ignores an unrelated exhibit doctype but rejects declarations in ownership XML', () => {
		const source = readFileSync('tests/fixtures/sec/xcel-form3-exhibit.txt', 'utf8');
		expect(parseOwnership(source, '0001389812-26-000004', 'h').form).toBe('3');
		expect(() => parseOwnership(source.replace('<ownershipDocument', '<!DOCTYPE ownershipDocument><ownershipDocument'), acc, 'h')).toThrow('forbidden');
	});
	it('parses original XML embedded in SGML with fractional shares and footnotes', () => {
		const p = parseOwnership(ownership,acc,'h'); expect(p.issuerCik).toBe('0000789019'); expect(p.owners[0].cik).toBe('0001899931');
		expect(p.acceptedAt).toBe('2026-08-05T22:08:55.000Z');
		expect(p.transactions[0]).toMatchObject({ side:'sell',volume:'4810.353',price:'496.48',amount:null,currency:null });
		expect(p.transactions[0].raw.footnotes).toBeTruthy();
		expect(parseOwnership(ownership,acc,'h').transactions[0].sourceRecordId).toBe(p.transactions[0].sourceRecordId);
		expect(parseOwnership(ownership,acc,'new').transactions[0].sourceRecordId).not.toBe(p.transactions[0].sourceRecordId);
	});
	it.each(['P','S','A','M','F','G'])('preserves transaction code %s without conflating acquisitions with purchases', (code) => {
		const xml = ownership.replace('<transactionCode>S','<transactionCode>'+code).replace('<value>D</value></transactionAcquiredDisposedCode>','<value>A</value></transactionAcquiredDisposedCode>');
		const tx = parseOwnership(xml,acc,'h').transactions[0]; expect(tx.side).toBe(code==='P' ? 'buy' : 'other'); expect(tx.raw.transactionCode).toBe(code);
	});
	it('keeps joint owners on one economic transaction', () => {
		const owner = ownership.match(/<reportingOwner>[\s\S]*?<\/reportingOwner>/)![0];
		const xml = ownership.replace('</reportingOwner>','</reportingOwner>'+owner.replace('0001899931','0001899932'));
		const p = parseOwnership(xml,acc,'h'); expect(p.owners).toHaveLength(2); expect(p.transactions).toHaveLength(1); expect(p.transactions[0].partyName).toBeNull();
	});
	it('retains amendments and holdings without inventing transactions', () => {
		const amended = ownership.replace('<documentType>4','<documentType>4/A').replace('<periodOfReport>','<dateOfOriginalSubmission>2026-08-05</dateOfOriginalSubmission><periodOfReport>');
		expect(parseOwnership(amended,acc,'h').originalSubmissionDate).toBe('2026-08-05');
		const holding = ownership.replace('<documentType>4','<documentType>3').replace(/nonDerivativeTransaction/g,'nonDerivativeHolding');
		expect(parseOwnership(holding,acc,'h').transactions).toHaveLength(0);
		expect(parseOwnership(ownership.replace('<documentType>4','<documentType>5'),acc,'h').form).toBe('5');
	});
	it('preserves derivative distinction and fails loudly on malformed or entity-bearing XML', () => {
		const derivative = ownership.replace(/nonDerivative/g,'derivative');
		expect(parseOwnership(derivative,acc,'h').transactions[0].instrumentType).toBe('derivative');
		expect(() => parseOwnership(ownership.replace('</transactionDate>',''),acc,'h')).toThrow();
		expect(() => parseOwnership('<!DOCTYPE x>'+ownership,acc,'h')).toThrow('forbidden');
		expect(() => parseOwnership('<html>Access denied</html>',acc,'h')).toThrow();
	});
});

function facts(values: Record<string, unknown>[]) { return { cik:789019,facts:{'us-gaap':{EarningsPerShareBasic:{units:{'USD/shares':values}}}}}; }
const annual = {val:-2,start:'2024-07-01',end:'2025-06-30',accn:'0000789019-25-000100',form:'10-K',filed:'2025-07-30',fy:2025,fp:'FY'};
describe('SEC financial normalization', () => {
	it('accepts null fiscal metadata from the real Microsoft response', () => {
		const source = JSON.parse(readFileSync('tests/fixtures/sec/msft-companyfacts.json','utf8'));
		const result = normalizeFacts(source,'0000789019','real-fixture','2022-01-01');
		expect(result.facts).toHaveLength(1);
		expect(result.facts[0]).toMatchObject({ metric:'eps_basic',periodType:'FY',periodStart:'2024-07-01',periodEnd:'2025-06-30' });
	});
	it('uses actual dates when a retained financial fact has null fiscal metadata', () => {
		const result = normalizeFacts(facts([{...annual,fy:null,fp:null}]),'0000789019','null-fiscal','2022-01-01');
		expect(result.facts[0]).toMatchObject({periodType:'FY',metadata:{fy:null,fp:null}});
		expect(() => normalizeFacts(facts([{...annual,fy:'invalid'}]),'0000789019','invalid','2022-01-01')).toThrow();
	});
	it('keeps annual, quarter and overlapping YTD periods separate and does not invent TTM', () => {
		const p = normalizeFacts(facts([annual,{...annual,start:'2025-07-01',end:'2025-09-30',form:'10-Q'}, {...annual,start:'2025-07-01',end:'2025-12-31',form:'10-Q'}]),'0000789019','h','2022-01-01');
		expect(p.facts.map((f)=>f.periodType)).toEqual(['FY','Q','YTD_6M']); expect(p.facts[0].value).toBe('-2');
	});
	it('keeps amendments separate and collapses duplicate contexts', () => {
		const p = normalizeFacts(facts([annual,annual,{...annual,accn:'0000789019-25-000101',form:'10-K/A',val:3}]),'0000789019','h','2022-01-01');
		expect(p.facts).toHaveLength(2); expect(p.facts[0].sourceRecordId).not.toBe(p.facts[1].sourceRecordId);
	});
	it('quarantines conflicting values, wrong units and unsupported durations', () => {
		const conflict = normalizeFacts(facts([annual,{...annual,val:99}]),'0000789019','h','2022-01-01'); expect(conflict.facts).toHaveLength(2); expect(conflict.facts.every((f) => f.metadata.comparisonStatus === 'conflicting_source_values')).toBe(true);
		const doc = facts([annual]); doc.facts['us-gaap'].EarningsPerShareBasic.units = { EUR: [annual] } as never;
		expect(normalizeFacts(doc,'0000789019','h','2022-01-01').facts).toHaveLength(0);
		expect(normalizeFacts(facts([{...annual,start:'2025-06-01'}]),'0000789019','h','2022-01-01').facts).toHaveLength(0);
	});
	it('recognizes 53-week years and flags missing concepts explicitly', () => {
		const p = normalizeFacts(facts([{...annual,start:'2024-06-25',end:'2025-06-30'}]),'0000789019','h','2022-01-01');
		expect(p.facts[0].periodType).toBe('FY'); expect(p.issues['missing:NetIncomeLoss']).toBe(1);
	});
});
