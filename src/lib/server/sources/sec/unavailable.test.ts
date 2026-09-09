import { describe, expect, it } from 'vitest';
import { absentFromInventories } from './unavailable.js';
const filing = { externalId: '0000000001-26-000002', filedDate: '2026-03-15' };
const index = 'CIK|Company Name|Form Type|Date Filed|Filename\n1|Fixture|4|2026-03-01|edgar/data/1/0000000001-26-000001.txt';
const submissions = { cik: 1, filings: { recent: { accessionNumber: ['0000000001-26-000001', '0000000001-26-000003'], form: ['4', '4'], filingDate: ['2026-03-01', '2026-03-30'] } } };
describe('verified SEC unavailability', () => {
	it('requires absence from both validated inventories covering the filing date', () => {
		expect(absentFromInventories(filing, '0000000001', index, submissions)).toBe(true);
		expect(absentFromInventories(filing, '0000000001', index.replace('000001.txt', '000002.txt'), submissions)).toBe(false);
		const present = structuredClone(submissions); present.filings.recent.accessionNumber[0] = filing.externalId;
		expect(absentFromInventories(filing, '0000000001', index, present)).toBe(false);
		const short = structuredClone(submissions); short.filings.recent.filingDate[0] = '2026-03-20';
		expect(absentFromInventories(filing, '0000000001', index, short)).toBe(false);
	});
	it('rejects missing or malformed evidence instead of inferring removal', () => {
		expect(() => absentFromInventories(filing, '0000000001', '<html>Unavailable</html>', submissions)).toThrow();
		expect(() => absentFromInventories(filing, '0000000002', index, submissions)).toThrow();
		expect(absentFromInventories(filing, '0000000001', index.split('\n')[0], submissions)).toBe(false);
	});
});
