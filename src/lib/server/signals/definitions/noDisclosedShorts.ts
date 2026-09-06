import { MAX_SNAPSHOT_AGE_DAYS, PUBLIC_THRESHOLD_PCT } from '../../shortSellers/analysis.js';
import { unknownShortSellers } from '../../../shortSellers.js';
import type { SignalDefinition } from '../types.js';

export const noDisclosedShortsSignal: SignalDefinition = {
	slug: 'no_disclosed_shorts', name: 'No Disclosed Shorts', version: 1, role: 'confirmation',
	params: { confirmation_weight: 0.10, public_threshold_pct: PUBLIC_THRESHOLD_PCT, max_snapshot_age_days: MAX_SNAPSHOT_AGE_DAYS },
	evaluate(instrument) {
		const shortSellers = instrument.shortSellers ?? unknownShortSellers();
		const passedGate = shortSellers.status === 'none_disclosed' && shortSellers.freshness === 'fresh';
		return {
			passedGate, score: passedGate ? 0.10 : null,
			rationale: { shortSellers, headline: passedGate ? 'No publicly disclosed short positions' :
				shortSellers.status === 'present' ? 'Publicly disclosed short positions' : 'Short seller data unavailable' }
		};
	}
};
