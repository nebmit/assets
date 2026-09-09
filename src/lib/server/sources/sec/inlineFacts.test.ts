import { describe, expect, it } from 'vitest';
import { parseInlineFacts } from './inlineFacts.js';
const source = `<html xmlns:us-gaap="http://fasb.org/us-gaap/2026" xmlns:custom="https://example.com/custom"><xbrli:context id="class"><xbrli:entity><xbrli:identifier>1</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">custom:ClassACommonStockMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context><xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit><ix:nonFraction name="us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic" contextRef="class" unitRef="usd" scale="6" sign="-">1,200</ix:nonFraction></html>`;
describe('targeted filing XBRL contexts', () => {
	it('retains class scope, fiscal duration and decimal scale/sign', () => {
		expect(parseInlineFacts(source)[0]).toMatchObject({ metric: 'net_income_common', value: '-1200000000', currency: 'USD', classMember: 'custom:ClassACommonStockMember', periodStart: '2025-01-01', periodEnd: '2025-12-31' });
	});
	it('preserves class-specific per-share units and rejects incompatible monetary units', () => {
		const unit = '<xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide>';
		const dividends = source.replace('NetIncomeLossAvailableToCommonStockholdersBasic', 'CommonStockDividendsPerShareDeclared').replace('<xbrli:measure>iso4217:USD</xbrli:measure>', unit);
		expect(parseInlineFacts(dividends)[0]).toMatchObject({ metric: 'dividend_per_share', unit: 'USD/shares', currency: 'USD', classMember: 'custom:ClassACommonStockMember' });
		expect(parseInlineFacts(source.replace('iso4217:USD', 'xbrli:shares'))).toEqual([]);
	});
	it('rejects extension concepts and unrelated dimensions instead of treating them as issuer facts', () => {
		expect(parseInlineFacts(source.replace('name="us-gaap:', 'name="custom:'))).toEqual([]);
		expect(parseInlineFacts(source.replace('StatementClassOfStockAxis', 'StatementBusinessSegmentsAxis'))).toEqual([]);
	});
	it('parses standard instance facts and fails loudly for malformed contexts', () => {
		const instance = source.replace('<ix:nonFraction name="us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic"', '<us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic').replace('</ix:nonFraction>', '</us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic>');
		expect(parseInlineFacts(instance)[0].value).toBe('-1200000000');
		expect(() => parseInlineFacts(source.replace('</xbrli:period>', ''))).toThrow();
	});
});
