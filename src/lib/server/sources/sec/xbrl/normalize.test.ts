import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { artifactSchema } from './types.js';
import { normalizeArtifact } from './normalize.js';
const artifact = artifactSchema.parse(JSON.parse(readFileSync('tests/fixtures/sec/xbrl/dks-cover-artifact.json', 'utf8')));
describe('filing semantics', () => {
	it('retains both DKS share counts without guessing the listed class', () => {
		const result = normalizeArtifact(artifact, '0001089063', [{ instrumentId: 311, symbol: 'DKS' }]);
		expect(result.classInventory).toEqual(['common:CommonClassAMember', 'common:CommonClassBMember']);
		expect(result.bindings).toEqual({});
		expect(result.candidates.filter((f) => f.metric === 'shares_outstanding')).toEqual(expect.arrayContaining([
			expect.objectContaining({ value: '65355923', classId: 'common:CommonClassAMember', instrumentId: null, reasonCode: 'listed_class_unresolved' }),
			expect.objectContaining({ value: '23570633', classId: 'common:CommonClassBMember', instrumentId: null, reasonCode: 'listed_class_unresolved' })
		]));
	});
	it('binds a class only through the symbol context and keeps unrelated dimensions out', () => {
		const a = structuredClone(artifact);
		const symbol = a.facts.find((f) => f.concept.endsWith('}TradingSymbol'))!;
		symbol.context = a.facts.find((f) => f.concept.endsWith('}EntityCommonStockSharesOutstanding'))!.context;
		const result = normalizeArtifact(a, '1089063', [{ instrumentId: 311, symbol: 'DKS' }]);
		expect(result.bindings).toEqual({ 'common:CommonClassAMember': 311 });
		expect(result.candidates.some((f) => f.scope === 'other' && f.qualification === 'rejected')).toBe(true);
	});
	it('quarantines calculation-conflicting evidence and rejects a foreign entity', () => {
		const result = normalizeArtifact(artifact, '1089063', []);
		expect(result.candidates.some((f) => f.metric === 'equity' && f.qualification === 'conflicting')).toBe(true);
		expect(normalizeArtifact(artifact, '9999999', []).candidates).toEqual([]);
	});
	it('does not interpret a custom namespace as a standard monetary concept', () => {
		const a = structuredClone(artifact);
		a.facts = a.facts.filter((f) => f.concept.endsWith('}EntityCommonStockSharesOutstanding')).map((f) => ({ ...f, concept: '{https://example.com}EntityCommonStockSharesOutstanding' }));
		expect(normalizeArtifact(a, '1089063', []).candidates).toEqual([]);
	});
});
