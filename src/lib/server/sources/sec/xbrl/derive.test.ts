import { describe, expect, it } from 'vitest';
import { reconstructStandardTotals } from './derive.js';
import type { XbrlArtifact, XbrlFact } from './types.js';
const parent = '{http://fasb.org/us-gaap/2026}CommonStockIncludingAdditionalPaidInCapital';
const fact = (concept: string, value: string): XbrlFact => ({ id: concept, concept, context: 'c', unit: 'u', value, numeric: true, nil: false, valid: true, decimals: 'INF', precision: null, document: 'https://example.com/report', line: 1 });
function artifact(): XbrlArtifact {
	return { schemaVersion: 1, parserVersion: 'arelle-2.43.1:1', facts: [fact('{custom}Par', '100'), fact('{custom}PaidIn', '200')], contexts: [{ id: 'c', entity: '1', scheme: 'http://www.sec.gov/CIK', start: null, end: '2026-01-01', instant: true, dimensions: [], valid: true }], units: { u: { numerator: ['USD'], denominator: [] } }, diagnostics: [], relationships: ['Par','PaidIn'].map((name) => ({ arcrole: 'http://www.xbrl.org/2003/arcrole/summation-item', role: 'balance', from: parent, to: `{custom}${name}`, weight: '1' })) };
}
describe('explicit calculation reconstruction', () => {
	it('reconstructs a standard total from complete custom inputs with evidence', () => {
		const result = reconstructStandardTotals(artifact());
		expect(result.facts).toHaveLength(1); expect(result.facts[0].value).toBe('300');
		expect(result.inputs.get(result.facts[0].id)).toEqual(['{custom}Par', '{custom}PaidIn']);
	});
	it('refuses incomplete, inconsistent, and nil-reported totals', () => {
		const a = artifact(); a.facts.pop(); expect(reconstructStandardTotals(a).facts).toEqual([]);
		const b = artifact(); b.diagnostics.push({ severity: 'inconsistency', code: 'calc', message: '', refs: ['{custom}Par'] }); expect(reconstructStandardTotals(b).facts).toEqual([]);
		const c = artifact(); c.facts.push({ ...fact(parent, '0'), nil: true, value: null }); expect(reconstructStandardTotals(c).facts).toEqual([]);
	});
});
