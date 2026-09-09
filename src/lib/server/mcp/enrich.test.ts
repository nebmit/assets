import { describe, expect, it } from 'vitest';
import { sectorConcentration, toDealingView } from './enrich.js';

const RUN_DATE = '2026-07-01';

function makeRow(overrides: Partial<Parameters<typeof toDealingView>[0]>) {
	return {
		fxRateEvidence: null, id: 1, economicKey: 'test', owners: [], price: 81.7, source: 'bafin', currencyStatus: 'explicit' as const,
		qualification: 'qualified', qualificationReason: null, url: null, filingId: null,
		partyName: 'Armin Example', partyRole: 'executive' as const, side: 'buy' as const,
		instrumentType: 'common_share', amount: 100_000, amountEur: overrides.amount === undefined ? 100_000 : overrides.amount,
		currency: 'EUR', buyerKey: 'Armin', transactionDate: '2026-06-30', publishedDate: RUN_DATE,
		...overrides
	};
}

describe('toDealingView', () => {
	it('maps an open-market share purchase with full signal weight', () => {
		const view = toDealingView(makeRow({}), RUN_DATE);
		expect(view).toMatchObject({
			party: 'Armin Example',
			role: 'executive',
			roleWeight: 1,
			dealingType: 'purchase',
			countedInSignal: true,
			amount: 100_000,
			price: 81.7
		});
		// published on the run date: no decay, executive weight 1.0
		expect(view.decayedWeightEur).toBeCloseTo(100_000);
	});

	it('decays and role-weights the credited amount', () => {
		const view = toDealingView(
			makeRow({ partyRole: 'related_party', publishedDate: '2026-06-10' }), // 21d old
			RUN_DATE
		);
		expect(view.roleWeight).toBe(0.6);
		expect(view.decayedWeightEur).toBeCloseTo(100_000 * 0.6 * 0.5);
	});

	it('classifies Sonstiges as settlement_or_award and excludes it from the signal', () => {
		const view = toDealingView(makeRow({ side: 'other' }), RUN_DATE);
		expect(view.dealingType).toBe('settlement_or_award');
		expect(view.countedInSignal).toBe(false);
		expect(view.decayedWeightEur).toBeNull();
	});

	it('counts share sells in the signal but credits them no buy weight', () => {
		const view = toDealingView(makeRow({ side: 'sell' }), RUN_DATE);
		expect(view.dealingType).toBe('sale');
		expect(view.countedInSignal).toBe(true);
		expect(view.decayedWeightEur).toBeNull();
	});

	it('excludes non-share instruments and missing amounts from the signal', () => {
		expect(toDealingView(makeRow({ instrumentType: 'Schuldverschreibung' }), RUN_DATE).countedInSignal).toBe(false);
		expect(toDealingView(makeRow({ amount: null }), RUN_DATE)).toMatchObject({
			countedInSignal: false,
			amount: null,
			decayedWeightEur: null
		});
	});
});

describe('sectorConcentration', () => {
	it('counts same-bucket peers, excluding the row itself', () => {
		const passers = [
			{ assetId: 'DE1', issuerId: 1, sector: 'Automobile Production' },
			{ assetId: 'DE2', issuerId: 2, sector: 'Machinery' },
			{ assetId: 'DE3', issuerId: 3, sector: 'Aerospace & Defence' },
			{ assetId: 'DE4', issuerId: 4, sector: 'Banking' }
		];
		const out = sectorConcentration(passers);
		// autos + machinery + defence all land in Industrials
		expect(out.get('DE1')).toEqual({ superSector: 'Industrials', peersFiring: 2 });
		expect(out.get('DE4')).toEqual({ superSector: 'Financials', peersFiring: 0 });
	});

	it('returns null for unclassified sectors and counts issuers, not listings', () => {
		const passers = [
			{ assetId: 'DE1', issuerId: 1, sector: 'Automobile Production' },
			{ assetId: 'DE2', issuerId: 1, sector: 'Automobile Production' }, // second listing, same issuer
			{ assetId: 'DE3', issuerId: 3, sector: null }
		];
		const out = sectorConcentration(passers);
		expect(out.get('DE1')?.peersFiring).toBe(0);
		expect(out.get('DE3')).toEqual({ superSector: null, peersFiring: null });
	});
});
