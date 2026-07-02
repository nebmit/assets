# assets

Asset surfacing system: surfaces buy-side signals on German equities
(DAX/MDAX/SDAX) — we surface, we never recommend. See the baseline doc for
positioning and scope.

## Architecture

`Ingestion → Normalization & Store → Signal Engine → Surfacing Layer`

- **Web app** (SvelteKit, `src/routes`) — surfacing UI, arrives in Phase 2.
- **Worker** (`src/worker/main.ts`) — daily pre-market batch: ingestion +
  signal engine, scheduled in-process (croner). Shares all domain code with
  the app via `src/lib/server` (kept free of SvelteKit-specific imports).
- **Postgres** — normalized, market-agnostic store (Drizzle ORM,
  migrations in `drizzle/`).

### Data sources (open/free only)

| Data | Source | Notes |
|---|---|---|
| Index constituents, master data | api.boerse-frankfurt.de | Undocumented JSON API; tracing-header handshake in `sources/boerseFrankfurt/client.ts` |
| EOD prices (XETR) | api.boerse-frankfurt.de | ~2y backfill, then incremental |
| Fundamentals bootstrap (EPS, shares, market cap) | api.boerse-frankfurt.de | Daily point-in-time snapshot; ESEF/Unternehmensregister parser is a later milestone |
| Insider transactions (Art. 19 MAR) | BaFin DealingsInfo | Full rolling 12-month CSV export per run, natural-key dedupe |

### Signal engine

Screen = boolean gate + continuous score, percentile-ranked within the daily
universe of gate-passers; raw inputs stored in `signal.rationale`. All data
access is point-in-time (`published_date <= run_date`, no lookahead). v1
screens: `insider_conviction`, `relative_value`, `value_insider_composite`
(equal weights).

## Development

```bash
docker compose up -d postgres   # local DB
npm install
npm run worker -- run           # migrate + full pipeline for today
npm run worker -- run --job=signals --date=2026-07-01
npm run worker -- report --top=10
npm run dev                     # web app (placeholder until Phase 2)
npm test                        # unit tests; set TEST_DATABASE_URL for the DB integration test
```

Configuration via environment (see `.env.example`): `DATABASE_URL`,
`RAW_DATA_DIR` (raw source payload archive), `INGEST_CRON`, `TZ`.

## Production

One image (see `Dockerfile`) serves both containers: the SvelteKit server
(`node build`) and the worker (`node build/worker.js schedule`), wired up in
`docker-compose.yml`. The worker applies migrations at boot and runs the
pipeline daily at 06:30 Europe/Berlin.
