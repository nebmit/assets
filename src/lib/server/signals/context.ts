import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { METRICS } from '../fundamentals/metrics.js';
import { addDays } from '../util.js';
import type { InsiderTx, UniverseContext, UniverseInstrument } from './types.js';

export const INSIDER_WINDOW_DAYS = 30;

/**
 * Build the point-in-time view of the universe for a run date. Everything is
 * filtered by publishedDate/tradeDate <= runDate so re-running a historical
 * date can never see data that wasn't public at the time (no lookahead).
 */
export async function buildContext(db: Db, runDate: string): Promise<UniverseContext> {
	const members = (await db.execute(sql`
		select distinct on (i.id)
			i.id as instrument_id, i.issuer_id, i.isin, i.ticker,
			s.name, s.sector, m.index_name
		from instrument i
		join issuer s on s.id = i.issuer_id
		join index_membership m on m.instrument_id = i.id
		where m.valid_from <= ${runDate} and (m.valid_to is null or m.valid_to > ${runDate})
		-- index_name tie-breaker: deterministic pick should an instrument ever
		-- carry overlapping memberships (data issue); DAX sorts first
		order by i.id, m.index_name, m.valid_from desc
	`)) as unknown as {
		instrument_id: number;
		issuer_id: number;
		isin: string;
		ticker: string | null;
		name: string;
		sector: string | null;
		index_name: 'DAX' | 'MDAX' | 'SDAX';
	}[];

	const closes = (await db.execute(sql`
		select distinct on (instrument_id) instrument_id, trade_date, close
		from eod_price
		where trade_date <= ${runDate}
		order by instrument_id, trade_date desc
	`)) as unknown as { instrument_id: number; trade_date: string; close: string }[];
	const closeByInstrument = new Map(closes.map((r) => [r.instrument_id, r]));

	const fundamentals = (await db.execute(sql`
		select distinct on (issuer_id, metric) issuer_id, metric, value
		from fundamental
		where published_date <= ${runDate}
			and metric in (${METRICS.epsBasic}, ${METRICS.marketCap}, ${METRICS.dividendPerShare})
		order by issuer_id, metric, published_date desc, period_end desc
	`)) as unknown as { issuer_id: number; metric: string; value: string }[];
	const fundamentalByIssuer = new Map<string, number>();
	for (const row of fundamentals) {
		fundamentalByIssuer.set(`${row.issuer_id}:${row.metric}`, Number(row.value));
	}

	const hiLo = (await db.execute(sql`
		select instrument_id, max(close) as hi, min(close) as lo
		from eod_price
		where trade_date <= ${runDate} and trade_date > ${addDays(runDate, -365)}
		group by instrument_id
	`)) as unknown as { instrument_id: number; hi: string; lo: string }[];
	const hiLoByInstrument = new Map(hiLo.map((r) => [r.instrument_id, r]));

	const ref3m = await referenceCloses(db, runDate, 91);
	const ref6m = await referenceCloses(db, runDate, 182);

	const windowStart = addDays(runDate, -INSIDER_WINDOW_DAYS);
	const dealings = (await db.execute(sql`
		select issuer_id, party_name, party_role, side, instrument_type,
			amount, transaction_date, published_date
		from insider_transaction
		where issuer_id is not null
			and transaction_date > ${windowStart} and transaction_date <= ${runDate}
			and published_date <= ${runDate}
	`)) as unknown as {
		issuer_id: number;
		party_name: string | null;
		party_role: InsiderTx['partyRole'];
		side: InsiderTx['side'];
		instrument_type: string | null;
		amount: string | null;
		transaction_date: string;
		published_date: string;
	}[];
	const txByIssuer = new Map<number, InsiderTx[]>();
	for (const row of dealings) {
		const list = txByIssuer.get(row.issuer_id) ?? [];
		list.push({
			partyName: row.party_name,
			partyRole: row.party_role,
			side: row.side,
			instrumentType: row.instrument_type,
			amount: row.amount === null ? null : Number(row.amount),
			transactionDate: row.transaction_date,
			publishedDate: row.published_date
		});
		txByIssuer.set(row.issuer_id, list);
	}

	const instruments: UniverseInstrument[] = members.map((m) => {
		const close = closeByInstrument.get(m.instrument_id);
		const closeValue = close ? Number(close.close) : null;
		const range = hiLoByInstrument.get(m.instrument_id);
		const base3m = ref3m.get(m.instrument_id) ?? null;
		const base6m = ref6m.get(m.instrument_id) ?? null;
		const returnFrom = (base: number | null) =>
			closeValue !== null && base !== null && base > 0 ? closeValue / base - 1 : null;
		return {
			instrumentId: m.instrument_id,
			issuerId: m.issuer_id,
			isin: m.isin,
			ticker: m.ticker,
			name: m.name,
			sector: m.sector,
			indexName: m.index_name,
			close: closeValue,
			closeDate: close?.trade_date ?? null,
			epsBasic: fundamentalByIssuer.get(`${m.issuer_id}:${METRICS.epsBasic}`) ?? null,
			marketCap: fundamentalByIssuer.get(`${m.issuer_id}:${METRICS.marketCap}`) ?? null,
			dividendPerShare: fundamentalByIssuer.get(`${m.issuer_id}:${METRICS.dividendPerShare}`) ?? null,
			return3m: returnFrom(base3m),
			return6m: returnFrom(base6m),
			drawdown52w:
				closeValue !== null && range && Number(range.hi) > 0 ? closeValue / Number(range.hi) - 1 : null,
			above52wLow:
				closeValue !== null && range && Number(range.lo) > 0 ? closeValue / Number(range.lo) - 1 : null,
			insiderTx: txByIssuer.get(m.issuer_id) ?? []
		};
	});

	return { runDate, instruments };
}

/**
 * Closest close at or before runDate − daysAgo per instrument, bounded to a
 * 60-day lookback window so thin listings don't produce ancient references.
 */
async function referenceCloses(db: Db, runDate: string, daysAgo: number): Promise<Map<number, number>> {
	const rows = (await db.execute(sql`
		select distinct on (instrument_id) instrument_id, close
		from eod_price
		where trade_date <= ${addDays(runDate, -daysAgo)}
			and trade_date > ${addDays(runDate, -(daysAgo + 60))}
		order by instrument_id, trade_date desc
	`)) as unknown as { instrument_id: number; close: string }[];
	return new Map(rows.map((r) => [r.instrument_id, Number(r.close)]));
}
