import { describe, expect, it } from 'vitest';
import { parseRates } from './rates.js';
const xml = '<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"><Cube><Cube time="2026-07-01"><Cube currency="USD" rate="1.17"/></Cube></Cube></gesmes:Envelope>';
describe('dated ECB rates', () => {
	it('retains singleton dates and currencies without inventing observations', () => {
		expect(parseRates(xml)).toEqual([{ date: '2026-07-01', currency: 'USD', unitsPerEur: '1.17' }]);
	});
	it('rejects nonpositive rates, invalid dates and entity declarations', () => {
		expect(() => parseRates(xml.replace('1.17', '0'))).toThrow();
		expect(() => parseRates(xml.replace('2026-07-01', 'not-a-date'))).toThrow();
		expect(() => parseRates('<!DOCTYPE external>'+xml)).toThrow();
	});
});
