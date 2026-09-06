import type { ShortSellerAnalysis, ShortHolder } from '../../shortSellers.js';
import { unknownShortSellers } from '../../shortSellers.js';
import type { ParsedShortPosition, ParsedShortPositions } from '../sources/bundesanzeiger/parse.js';
import { daysBetween, isoDate } from '../util.js';

export const MAX_SNAPSHOT_AGE_DAYS = 3;
export const PUBLIC_THRESHOLD_PCT = 0.5;
export const validIsin = (isin: string | null): isin is string =>
	isin !== null && /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin);

export interface SnapshotDiagnostics {
	complete: boolean;
	unidentifiableRows: number;
	duplicatesCollapsed: number;
}

/** A partially parsed or empty export cannot certify absence. */
export function validateOpenExport(parsed: ParsedShortPositions, capturedAt: Date): SnapshotDiagnostics {
	if (parsed.rows.length === 0 || parsed.unparseable !== 0) {
		throw new Error('NLP open export is empty or incomplete');
	}
	const day = isoDate(capturedAt, 'Europe/Berlin');
	if (parsed.rows.some((r) => !Number.isFinite(r.positionPct) || r.positionPct < 0 ||
		r.positionPct > 100 || r.positionDate > day)) {
		throw new Error('NLP open export contains invalid percentages or future dates');
	}
	const unidentifiableRows = parsed.rows.filter((r) => !validIsin(r.isin)).length;
	return { complete: unidentifiableRows === 0, unidentifiableRows, duplicatesCollapsed: parsed.duplicatesCollapsed };
}

export interface PositionSnapshot {
	id: number;
	capturedAt: Date;
	rows: ParsedShortPosition[];
	diagnostics: SnapshotDiagnostics;
}

/** Snapshot availability uses observation time, never the older position date. */
export function analyzeShortSellers(
	snapshot: PositionSnapshot | null,
	identities: { isin: string; issuerId: number }[],
	runDate: string
): Map<number, ShortSellerAnalysis> {
	const result = new Map<number, ShortSellerAnalysis>();
	for (const { issuerId } of identities) result.set(issuerId, unknownShortSellers());
	if (!snapshot) return result;
	const capturedDay = isoDate(snapshot.capturedAt, 'Europe/Berlin');
	if (capturedDay > runDate) return result;
	const freshness = daysBetween(capturedDay, runDate) <= MAX_SNAPSHOT_AGE_DAYS ? 'fresh' : 'stale';
	const issuerByIsin = new Map(identities.map((i) => [i.isin, i.issuerId]));
	const byIssuer = new Map<number, Map<string, ParsedShortPosition[]>>();
	for (const row of snapshot.rows) {
		const issuerId = row.isin === null ? undefined : issuerByIsin.get(row.isin);
		if (issuerId === undefined) continue;
		const holders = byIssuer.get(issuerId) ?? new Map<string, ParsedShortPosition[]>();
		const latest = holders.get(row.holderNameRaw);
		if (!latest || row.positionDate > latest[0].positionDate) holders.set(row.holderNameRaw, [row]);
		else if (row.positionDate === latest[0].positionDate) latest.push(row);
		byIssuer.set(issuerId, holders);
	}
	for (const issuerId of result.keys()) {
		const holders: ShortHolder[] = [];
		let conflict = false;
		for (const rows of byIssuer.get(issuerId)?.values() ?? []) {
			if (new Set(rows.map((r) => r.positionPct)).size > 1) { conflict = true; continue; }
			const row = rows[0];
			if (row.positionPct >= PUBLIC_THRESHOLD_PCT) holders.push({
				holderName: row.holderNameRaw, positionPct: row.positionPct, positionDate: row.positionDate
			});
		}
		holders.sort((a, b) => b.positionPct - a.positionPct || a.holderName.localeCompare(b.holderName));
		const status = conflict ? 'unknown' : holders.length > 0 ? 'present' :
			snapshot.diagnostics.complete ? 'none_disclosed' : 'unknown';
		// Incomplete identity coverage also makes the aggregate unknowable.
		const knownTotal = status !== 'unknown' && snapshot.diagnostics.complete;
		result.set(issuerId, {
			status, freshness, snapshotId: snapshot.id, capturedAt: snapshot.capturedAt.toISOString(),
			holderCount: knownTotal ? holders.length : null,
			totalDisclosedPct: knownTotal ? Number(holders.reduce((sum, h) => sum + h.positionPct, 0).toFixed(6)) : null,
			holders
		});
	}
	return result;
}
