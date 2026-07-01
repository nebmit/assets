export function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Percentile of each score within its cohort: fraction of cohort scores <=
 * the score, in (0, 1]. Ties share a percentile; higher score = higher
 * percentile = stronger signal.
 */
export function percentileRanks(scores: number[]): number[] {
	const sorted = [...scores].sort((a, b) => a - b);
	return scores.map((score) => {
		let hi = sorted.length;
		let lo = 0;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (sorted[mid] <= score) lo = mid + 1;
			else hi = mid;
		}
		return lo / sorted.length;
	});
}
