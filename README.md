# assets

Asset surfacing system: surfaces buy-side signals on German equities
(DAX/MDAX/SDAX) — we surface, we never recommend. See the baseline doc for
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
|---|---|---|
| Index constituents, master data | api.boerse-frankfurt.de | Undocumented JSON API; tracing-header handshake in `sources/boerseFrankfurt/client.ts` |
| EOD prices (XETR) | api.boerse-frankfurt.de | ~2y `price_history` backfill for new instruments; daily closes come from the snapshot |
| Fundamentals bootstrap + daily closes (EPS, market cap, dividend, prev close) | api.boerse-frankfurt.de | `equity_search` snapshot, one request per index per day; ESEF/Unternehmensregister parser is a later milestone |
| Insider transactions (Art. 19 MAR) | BaFin DealingsInfo | Full rolling 12-month CSV export per run, natural-key dedupe |

The BF API silently tarpits callers after request bursts (~150+ at sub-second
spacing), so the client rate-limits hard (2.5s), keeps per-request budgets
short, and trips a circuit breaker after 3 consecutive transport failures —
a penalty-boxed job fails in minutes and self-heals on the next daily run.
Steady state uses under ten requests per day; per-instrument endpoints are
reserved for backfill.

### Signal engine

A signal = an absolute materiality gate + a calibrated severity in [0, 1]
(~0.2 barely material, ~0.5 strong, ~1 exceptional — comparable across
runs, so an empty day is a valid, meaningful answer). Raw inputs live in
`signal.rationale`, including a human-readable `headline`. All data access
is point-in-time (`published_date <= run_date`, no lookahead).

- `insider_conviction` (v2): role-weighted, publication-decayed insider
  share *buying* over 30 days. Gate: cap-band floor (€100k DAX / €50k MDAX
  / €25k SDAX role-weighted; halved for ≥2-buyer clusters). Sells only
  dampen, never erase, buys; buying into a falling price boosts severity.
- `relative_value` (v2): P/E vs the super-sector peer median
  (`signals/sectors.ts` buckets BF's granular sectors; index median as
  fallback). Gate: a *material* discount (≥15%), fresh close, positive
  EPS, and no falling knife (>35% six-month drop). Dividend yield adds a
  small support bonus.
- `surfaced`: the headline feed — the *union* of fired signals, combined by
  noisy-or (`1 − Π(1 − severity)`). One fired signal surfaces the asset;
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
npm run worker -- run           # migrate + full pipeline for today
npm run worker -- run --job=signals --date=2026-07-01
npm run worker -- report --top=10
npm run seed:demo               # DESTRUCTIVE dev seed: demo universe + real signal run
npm run dev                     # web app (surfaced feed at /)
npm test                        # unit tests; set TEST_DATABASE_URL for the DB integration test
```

Configuration via environment (see `.env.example`): `DATABASE_URL`,
`RAW_DATA_DIR` (raw source payload archive), `INGEST_CRON`, `TZ`, plus the
SSO/OAuth wiring `AUTH_ORIGIN`, `RESOURCE_URL`, `INTROSPECTION_SECRET`.

## Production

One image (see `Dockerfile`) serves both containers: the SvelteKit server
(`node build`) and the worker (`node build/worker.js schedule`). Production
composition is owned by the infra repo at
`services/assets/compose.caddy.yml`; this repo's `docker-compose.yml` is only
for the local Postgres dependency. The worker applies migrations at boot and
runs the pipeline daily at 06:30 Europe/Berlin by default.
