/** Public disclosure data, shared by the engine, web UI and MCP. Percentages are percentage points. */
export interface ShortHolder {
	holderName: string;
	positionPct: number;
	positionDate: string;
}

export interface ShortSellerAnalysis {
	status: 'present' | 'none_disclosed' | 'unknown' | 'unavailable';
	freshness: 'fresh' | 'stale' | 'unavailable';
	snapshotId: number | null;
	capturedAt: string | null;
	holderCount: number | null;
	totalDisclosedPct: number | null;
	holders: ShortHolder[];
}

export function unknownShortSellers(): ShortSellerAnalysis {
	return {
		status: 'unknown', freshness: 'unavailable', snapshotId: null, capturedAt: null,
		holderCount: null, totalDisclosedPct: null, holders: []
	};
}
