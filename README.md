# assets

Asset surfacing system: surfaces buy-side signals on German and US equities
(DAX/MDAX/SDAX and S&P 500/MidCap 400 holdings proxies) — we surface, we never recommend. See the baseline doc for
positioning and scope.

## Architecture

`Ingestion → Normalization & Store → Signal Engine → Surfacing Layer`

- **Web app** (SvelteKit, `src/routes`) — surfacing UI: the surfaced feed
  (assets whose signals fired, as rich cards — evidence badges with
  day-over-day lifecycle, price chart, valuation vs sector, insider
  dealings, regulatory news), SSR-loaded point-in-time from the latest
  signal run. Design tokens live in `src/app.css`; the design system's
  primitives are reimplemented in `src/lib/components/ds`.
- **Worker** (`src/worker/main.ts`) — daily pre-market batch: ingestion +
  signal engine, scheduled in-process (croner). Shares all domain code with
  the app via `src/lib/server` (kept free of SvelteKit-specific imports).
- **Postgres** — normalized, market-agnostic store (Drizzle ORM,
  migrations in `drizzle/`).

### Data sources (open/free only)

| Data | Source | Notes |
| --- | --- | --- |
| Index constituents, master data | api.boerse-frankfurt.de | Undocumented JSON API; tracing-header handshake in `sources/boerseFrankfurt/client.ts` |
| EOD prices (XETR) | api.boerse-frankfurt.de | 3y `price_history` backfill for current instruments; daily closes come from the snapshot |
| Fundamentals bootstrap + daily closes (EPS, market cap, dividend, prev close) | api.boerse-frankfurt.de | `equity_search` snapshot, one request per index per day; ESEF/Unternehmensregister parser is a later milestone |
| US issuer filings, financial facts and ownership | SEC EDGAR | Archived originals, qualified periods/classes and revision-aware dealings |
| US daily prices and corporate actions | Alpaca | Authenticated historical SIP, raw USD bars, explicit split adjustment; no IEX fallback |
| Dated currency conversion for insider thresholds | ECB | Native monetary display; dated EUR comparison only |
| Insider transactions (Art. 19 MAR) | BaFin DealingsInfo | Full rolling 12-month CSV export per run, natural-key dedupe |
| Net short positions ≥0.5% (SSR 236/2012 Art. 6) | Bundesanzeiger Netto-Leerverkaufspositionen | Stateful Wicket session; 3y backfill then a rolling 90-day window, unioned with the open list; natural-key dedupe |

The BF API silently tarpits callers after request bursts (~150+ at sub-second
spacing), so the client rate-limits hard (2.5s), keeps per-request budgets
short, and trips a circuit breaker after 3 consecutive transport failures —
a penalty-boxed job fails in minutes and self-heals on the next daily run.
Split-consistent chart history currently refreshes per instrument, so a full German
price cycle takes several minutes at the provider’s required request spacing.

### Signal engine

A discovery signal = an absolute materiality gate + a calibrated severity in [0, 1]
(~0.2 barely material, ~0.5 strong, ~1 exceptional — comparable across
runs, so an empty day is a valid, meaningful answer). Raw inputs live in
`signal.rationale`, including a human-readable `headline`. All data access
is point-in-time (`published_date <= run_date`, no lookahead).

- `insider_conviction` (v4): role-weighted, publication-decayed insider
  share *buying* over 30 days. Gate: cap-band floor (€100k large / €50k mid
  / €25k small role-weighted; halved for ≥2-buyer clusters). Sells only
  dampen, never erase, buys; buying into a falling price boosts severity.
- `relative_value` (v4): P/E vs the super-sector peer median
  (`signals/sectors.ts` maps BF sectors and SEC SIC codes; size-band median as
  fallback, counting issuers once). Gate: a *material* discount (≥15%), fresh close, positive
  EPS, and no falling knife (>35% six-month drop). Dividend yield adds a
  small support bonus.
- `no_disclosed_shorts` (v1): fresh confirmed absence of public short positions;
  a 0.10 confirmation that contributes only after a discovery signal fires.
- `surfaced`: the headline feed — the *union* of fired discovery signals, combined by
  noisy-or (`1 − Π(1 − severity)`). One fired discovery signal surfaces the asset;
  more are confirmations, never a requirement. Per-row `reasons` carry each
  fired signal's headline + severity.

The `performance` job closes the loop: once 30/91/182 calendar days have
elapsed it records each fired signal's forward return against the
equal-weight universe mean into `signal_performance` (idempotent, catches
up daily); `worker report` prints the per-signal hit rates — the basis for
tuning floors and severity curves against measured outcomes.

### MCP endpoint

`POST /mcp` exposes the signals to MCP clients (Streamable HTTP, JSON
responses only — no SSE): `surface_latest` returns the surfaced feed of a
signal run (strongest first, with per-row `reasons`), and one read-only
facet tool per component signal (`signal_<slug>`) returns that signal's
fired rows, all as structured output.

Every row uses the immutable research snapshot saved with its signal run:
per-insider dealing detail (name, role, role weight, dates, prices,
`dealingType` preserves purchases, sales and other transactions; SEC purchases
may include private transactions. Currency inference and qualification explain whether it counted
toward severity), a point-in-time fundamentals snapshot (price, YTD
return, 52-week range, market cap, *trailing* P/E, dividend yield —
forward P/E and analyst consensus have no data source), every signal's
severity sub-components with gate flags (`components`, null-degrading on
rows from older engine versions), a 30-day news summary with the latest
headlines, and `superSector`/`sectorPeersFiring` (how many peers of the
same super-sector fired the same signal — a crowded sector is usually a
macro flag, not a stock-picker's edge).

`issuer_detail(assetId, runDate?)` is the drill-down for one instrument:
~36 months of monthly closes, EPS/market-cap/dividend history, the stored
directors'-dealings record (max 50, reaching back as far as ingestion
does), per-insider follow-through (prior counted buys with the ~91-day
forward return after each) and recent headlines.
Requests must send `Accept: application/json, text/event-stream`
(spec-mandated even though responses are plain JSON). Sessions are
server-minted via `Mcp-Session-Id` on `initialize` (in-memory, 30 min
idle expiry; `DELETE /mcp` ends one) and are bound to the authenticated
account. Guarded by a per-session rate limit (30 req/min; `initialize`
itself is limited per client IP, so behind a proxy set
`ADDRESS_HEADER`/`XFF_DEPTH`), a 16 KB body cap, and strict param
validation.

**Authentication is required**: every `/mcp` request needs an OAuth 2.1
bearer token issued by the timben.net authorization server for this
resource. Anonymous requests get `401` with a `WWW-Authenticate` challenge
pointing at `/.well-known/oauth-protected-resource` (RFC 9728), from which
MCP clients discover the authorization server and run the standard
dynamic-registration + PKCE flow — sign-in there is passkey-only, followed
by a consent page. Tokens are validated per request against the
authorization server's introspection endpoint (`INTROSPECTION_SECRET`,
short in-memory cache) and must carry this server's `RESOURCE_URL` as
audience. Point an MCP client at `https://<host>/mcp`, or inspect locally
with `npx @modelcontextprotocol/inspector` against
`http://localhost:5173/mcp` (with core.timben running as the authorization
server, see `AUTH_ORIGIN`).

The web UI also participates in browser SSO: `hooks.server.ts` resolves the
shared `.timben.net` session cookie via the SSO host and exposes
`locals.user`; the feed itself stays public.

For future user-owned data, `src/lib/crypto` provides client-side
encryption keyed by the shared timben.net passkeys via the WebAuthn PRF
extension (no passwords, no recovery email — see its README for the
envelope pattern and constraints).

## Development

```bash
docker compose up -d postgres   # local DB
npm install
npm run worker -- run           # combined daily cycle; drains selected SEC queues to completion
npm run worker -- backfill --source=sec # explicitly drain the SEC backlog (can take hours)
npm run worker -- run --job=signals --date=2026-07-01
npm run worker -- report --top=10
npm run seed:demo               # DESTRUCTIVE dev seed: demo universe + real signal run
npm run dev                     # web app (surfaced feed at /)
npm test                        # unit tests; set TEST_DATABASE_URL for the DB integration test
```

The standalone worker loads `.env` from its working directory; exported environment
variables take precedence. Configuration (see `.env.example`): `DATABASE_URL`,
`RAW_DATA_DIR` (raw source payload archive), `INGEST_CRON`, `TZ`, worker-only
`APCA_API_KEY_ID` / `APCA_API_SECRET_KEY` for Alpaca, plus the
SSO/OAuth wiring `AUTH_ORIGIN`, `RESOURCE_URL`, `INTROSPECTION_SECRET`.

The daily worker includes SEC ingestion for the S&P 500 and S&P MidCap 400 tracking-fund universe. Both source groups use the same schedule, defaulting to 06:30 Europe/Berlin. All ingestion precedes one combined snapshot and signal run, followed by performance. SEC backlog work is resumable and bounded in ordinary runs and scheduled cycles. `--source=sec` is an optional source filter, not required to enable SEC. See [SEC ingestion](docs/sec-ingestion.md) for coverage, index selection and replay commands.

## Production

One image (see `Dockerfile`) serves both containers: the SvelteKit server
(`node build`) and the worker (`node build/worker.js schedule`). Production
composition is owned by the infra repo at
`services/assets/compose.caddy.yml`; this repo's `docker-compose.yml` is only
for the local Postgres dependency. The worker applies migrations at boot and
runs the pipeline daily at 06:30 Europe/Berlin by default.

### Short seller analysis

The Bundesanzeiger job preserves validated, unfiltered open-register snapshots alongside
its disclosure history. Asset cards and every watchlist entry show public position status,
named holders, disclosed percentages, position dates, and the snapshot check date. The
watchlist joins the public asset catalog in the browser; private watchlist contents remain
in the existing encrypted store.

`no_disclosed_shorts` (No Disclosed Shorts) is a **confirmation** signal. Fresh confirmed
absence contributes 0.10 through noisy-or only after a discovery signal fires:
`combined = base + 0.10 * (1 - base)`. Absence alone never surfaces an asset, and presence
adds no penalty. The existing feed tabs remain discovery views; worker reports and MCP
also expose `signal_no_disclosed_shorts`. Both MCP reports and issuer detail include the
saved short seller analysis.

Public disclosure starts at 0.5% per holder. “No publicly disclosed short positions” does
not establish zero short interest. Sub-threshold final disclosures leave the active set;
conflicting latest disclosures produce unknown coverage. Invalid or incomplete exports
never certify absence. Unidentifiable rows block absence, while out-of-universe valid
ISINs do not. Totals are null when complete coverage cannot be established.

Snapshots are available only from their actual capture day in Europe/Berlin. They remain
fresh for three calendar days; older snapshots retain their dated details but do not boost
scores. Old position dates alone do not expire holdings. Dates before snapshot collection
began remain unknown. Signal rationales freeze the exact analysis used by a run, so later
ingestion cannot silently change its UI or MCP evidence. Regenerating a date replaces the
run; the feed cache notices the new run ID within its 60-second revalidation interval.

Roll out against the intended `DATABASE_URL`:

```sh
npm run worker -- migrate
npm run worker -- run --job=bundesanzeiger_short_positions
npm run worker -- run --job=signals
```

No additional credentials or environment variables are needed. Migration 0008 adds only
the snapshot table and capture-time index. Check the ingestion statistics and logs for
`open_export_failed` before expecting new coverage. `npm run seed:demo` includes clearly
synthetic short holders and remains destructive: use it only in a disposable database.
The CSV parser fixture combines representative source-format rows with synthetic edge cases.

Shared identity, migrations, qualification rules and rollout verification: [SEC feature parity](docs/sec-feature-parity.md).

### US data repair and coverage

SEC runs drain the selected universe without a cycle time budget. Individual
requests retain timeouts, retries and rate limiting; failures keep durable work
and make the command exit unsuccessfully. A combined run continues other source
ingesters but skips signals and performance when SEC is incomplete, retaining
the previous dashboard snapshot. The scheduler prevents overlap.

`npm run worker -- backfill --source=sec` repairs migrated financial news,
renormalizes outdated financial facts, and processes pending insider filings.
Repairs reuse archived filing evidence and are safe to repeat. News retains its
publication time and receives the actual repair observation time. An archive 404
is classified as unavailable only when the rebuilt SEC index and an issuer
submissions window covering that filing date also omit it; the verification
evidence is archived. A later rediscovery makes the filing eligible again.

After SEC repair, run `npm run worker -- run --source=alpaca`, then
`npm run worker -- run --job=signals` to refresh the current dashboard snapshot.
Historical snapshots are not rebuilt. `npm run worker -- report --source=sec`
includes normalization versions, filing queue counts and financial coverage
by reason for the latest saved snapshot.

US basic EPS can use parent earnings only when reported basic EPS and weighted
shares reconcile. Exact and rounded outstanding share counts can reconcile
within reported precision while retaining all contributing evidence. Common book equity requires explicit attribution, a preferred
capital deduction, or a reconciled common-equity breakdown. Unresolved classes,
conflicting facts and stale periods remain unavailable with a specific reason.
Losses are shown as EPS; their P/E is not meaningful. US aggregate short interest
is not integrated; the German named-holder disclosure panel is not evidence of
US short positions.
