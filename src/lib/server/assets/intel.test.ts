import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeFacts } from '../sources/sec/facts.js';
import { resolveFinancials, type Fact } from './financials.js';

const document = JSON.parse(readFileSync('tests/fixtures/sec/intel-companyfacts.json', 'utf8'));
describe('Intel SEC financial qualification', () => {
	it('recovers trailing losses and book value from actual reported tags', () => {
		const normalized = normalizeFacts(document, '0000050863', 'intel-fixture', '2024-01-01');
		const accessions = [...new Set(normalized.facts.map((f) => f.accession))];
		const facts: Fact[] = normalized.facts.map((f, i) => ({ ...f, id: i + 1, issuerId: 182, instrumentId: null, source: 'sec', filingId: accessions.indexOf(f.accession) + 1, publishedDate: f.filedDate, publishedAt: null, observedAt: new Date('2026-09-07'), qualification: 'unqualified', qualificationReason: 'requires_snapshot_qualification' }));
		const result = resolveFinancials({ facts, instrumentId: 182, scope: { earnings: 'issuer', classes: ['issuer'], inventoryComplete: true }, currency: 'USD', close: 95.8, runDate: '2026-09-08', actions: [], actionsComplete: true });
		expect(result.eps.state).toBe('qualified');
		// 364-day fiscal year + current 182-day YTD - prior 182-day YTD.
		expect(result.eps.value).toBeCloseTo(-11289000000 / ((4530000000 * 364 + 5108000000 * 182 - 4356000000 * 182) / 364));
		expect(result.pb.value).toBeCloseTo(483215200000 / 87542000000);
		expect(result.marketCap.value).toBe(483215200000);
		expect(result.eps.inputIds.length).toBeGreaterThanOrEqual(9);
	});
});
