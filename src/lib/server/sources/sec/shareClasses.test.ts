import { describe, expect, it } from 'vitest';
import { commonClassMembers, listedShareClasses, isUndesignatedCommonStockTitle } from './shareClasses.js';
const doc = `<html xmlns:dei="http://xbrl.sec.gov/dei/2026"><ix:nonNumeric name="dei:TradingSymbol" contextRef="listed">MA</ix:nonNumeric><ix:nonNumeric name="dei:Security12bTitle" contextRef="listed">Class A Common Stock</ix:nonNumeric></html>`;
describe('SEC common security identity', () => {
	it('matches a listed class through its cover-page trading symbol', () => {
		expect(listedShareClasses(doc).get('MA')).toBe('Class A Common Stock');
		expect(listedShareClasses(doc.replace('name="dei:TradingSymbol"', 'name="extension:TradingSymbol"')).size).toBe(0);
	});
	it('rejects ambiguous symbols or titles in the same context', () => {
		const extra = '<ix:nonNumeric name="dei:TradingSymbol" contextRef="listed">OTHER</ix:nonNumeric>';
		expect(listedShareClasses(doc.replace('</html>', extra + '</html>')).size).toBe(0);
	});
	it('does not confuse preferred shares with multiple common classes', () => {
		expect(commonClassMembers(['us-gaap:CommonStockMember', 'c:SeriesAPreferredStockMember'])).toEqual(['us-gaap:CommonStockMember']);
		expect(commonClassMembers(['us-gaap:CommonClassAMember', 'us-gaap:CommonClassBMember'])).toHaveLength(2);
	});
});

it('matches only explicitly undesignated common-stock cover titles', () => {
	expect(isUndesignatedCommonStockTitle('Common Stock, par value $0.01 per share')).toBe(true);
	for (const title of ['Class B Common Stock', 'Common Stock Class A', 'Nonvoting Common Stock', 'Common Stock, non-voting', 'Preferred Stock', '']) expect(isUndesignatedCommonStockTitle(title)).toBe(false);
});
