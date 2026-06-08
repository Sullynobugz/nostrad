# Nostrad

Personal paper-trading research system. The goal is to test whether a combined signal from event analysis, market sentiment, Polymarket context, and Kronos-style time-series analysis can produce better paper-trading decisions than a simple baseline.

This is not a SaaS product, has no auth flow, and does not place real-money trades.

## Current Status

Last validated: 2026-06-08

- Backend builds with `npm run build`.
- Backend runs on port `3000` with `npm run dev`.
- Supabase schema exists in `supabase/migrations.sql`.
- Runtime DB permissions for ingestion and signal generation were fixed with:
  - `supabase/20260608_service_role_ingestion_permissions.sql`
  - the same grants/policies appended to `supabase/migrations.sql`
- Paper-trading DB permissions are defined in:
  - `supabase/20260608_service_role_trading_permissions.sql`
  - the same grants/policies appended to `supabase/migrations.sql`
- The Supabase permission patch has been applied manually in the Supabase SQL Editor.
- `POST /api/ingest/run` successfully inserted events.
- `POST /api/signals/process-queue` successfully generated queued signals.
- Direct `POST /api/signals/generate` with an asset also inserts a signal.
- Dashboard includes a `How To Use` page and action buttons for the full MVP loop:
  `Ingest Run -> Process Queue -> Execute Signals -> Close Expired`.

Known external-source behavior during validation:

- Reddit JSON endpoints returned HTTP 403 for several subreddits.
- Some Reuters RSS feed hostnames failed DNS resolution.
- Finnhub candle requests sometimes returned HTTP 403; Kronos falls back to mock data where implemented.
- These source issues did not block validating the ingestion and signal persistence path.

## Business Context

Nostrad is a personal research terminal for paper trading with virtual capital. It is meant to answer:

- Can news/event relevance plus sentiment improve market timing?
- Does Polymarket probability data add useful directional context?
- Does time-series analysis improve or veto LLM-generated market ideas?
- Can the system produce auditable daily reports and post-mortems for learning?

The initial trade rules are deliberately conservative:

- Virtual starting balance: EUR 1,000.
- Maximum position size: EUR 100.
- A trade is eligible when `final_score >= 65` and `confidence >= 65`.
- Trades are closed after the configured hold period, defaulting to 24 hours.
- This is paper trading only.

## Technical Overview

Backend:

- TypeScript
- Express
- Supabase PostgreSQL via `@supabase/supabase-js`
- Anthropic SDK for LLM tool-call based engines

Dashboard:

- React
- Vite
- Tailwind

Data and engine paths:

- RSS, Finnhub, Reddit, and Polymarket provide input data.
- Market data falls back in this order: Finnhub -> Twelve Data -> Alpha Vantage -> Yahoo Finance public chart API.
- `eventEngine` scores raw news/events.
- `sentimentEngine` scores social/news sentiment.
- `polymarketEngine` reads relevant market probabilities.
- `kronosEngine` provides time-series direction, using configured mode or fallback behavior.
- `finalSignalEngine` combines all engine outputs.

Important source files:

- `src/index.ts` - Express server and route registration.
- `src/services/supabase.ts` - server-side Supabase client using `SUPABASE_SERVICE_KEY`.
- `src/services/anthropic.ts` - Anthropic tool-call helper. Keep `tool_choice: { type: "any" }`; do not re-enable `thinking` together with forced tool use.
- `src/routes/ingest.ts` - ingestion endpoints.
- `src/routes/signals.ts` - signal generation endpoints.
- `src/paperTrading/*` - paper trade execution, closing, and portfolio state.
- `supabase/migrations.sql` - schema plus service-role grants/policies.
- `supabase/20260608_service_role_ingestion_permissions.sql` - targeted patch for existing Supabase projects.
- `supabase/20260608_service_role_trading_permissions.sql` - targeted patch for existing projects to enable portfolio, paper trades, snapshots and open-trade view access.

## Environment

Required variables are in `.env.example`. Do not print real `.env` values in logs or chat.

Core variables:

- `ANTHROPIC_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `FINNHUB_API_KEY`
- `TWELVEDATA_API_KEY` optional fallback for market candles and quotes
- `ALPHAVANTAGE_API_KEY` optional fallback for market candles and quotes
- `KRONOS_MODE`
- `KRONOS_PYTHON_URL`

## Local Commands

From repo root:

```bash
cd /Users/sully/projects/nostrad
npm run build
npm run dev
```

Backend URL:

```text
http://localhost:3000
```

Useful checks:

```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/api/ingest/run
curl -X POST http://localhost:3000/api/signals/process-queue
curl -X POST http://localhost:3000/api/trades/execute
curl -X POST http://localhost:3000/api/trades/close-expired
curl http://localhost:3000/api/trades/portfolio
curl http://localhost:3000/api/trades/open
curl 'http://localhost:3000/api/signals/latest?limit=10'
curl -X POST http://localhost:3000/api/signals/generate \
  -H 'Content-Type: application/json' \
  -d '{"asset":"BTC"}'
```

## Last Validation Results

After applying `supabase/20260608_service_role_ingestion_permissions.sql` in Supabase SQL Editor:

```json
{"success":true,"inserted":24,"duplicates":6,"errors":[]}
```

from:

```bash
curl -X POST http://localhost:3000/api/ingest/run
```

Signal queue:

```json
{"success":true,"processed":10}
```

from:

```bash
curl -X POST http://localhost:3000/api/signals/process-queue
```

Direct signal generation also succeeded and inserted a `BTC` signal with status `pending`.

## Supabase Notes

The hosted Supabase project had table-level permission failures even while the backend used `SUPABASE_SERVICE_KEY`:

- `permission denied for table events`
- `permission denied for table signals`

The minimal fix was:

- Grant schema usage to `service_role`.
- Grant `select`, `insert`, and `update` on `events`.
- Grant `select`, `insert`, and `update` on `signals`.
- Enable RLS on `events` and `signals`.
- Add permissive service-role policies for those two tables.

For an existing hosted project, run:

```text
supabase/20260608_service_role_ingestion_permissions.sql
supabase/20260608_service_role_trading_permissions.sql
```

in the Supabase Dashboard SQL Editor.

Avoid using the Supabase CLI in a Codex session unless the user explicitly wants it. A previous attempt triggered a macOS Keychain permission loop while the CLI tried to access the Supabase access token.

## Rolling Start Checklist

1. `cd /Users/sully/projects/nostrad`
2. Do not print `.env`.
3. Run `npm run build`.
4. Start backend with `npm run dev` if port `3000` is free.
5. Check `curl http://localhost:3000/health`.
6. Run `curl -X POST http://localhost:3000/api/ingest/run`.
7. Run `curl -X POST http://localhost:3000/api/signals/process-queue`.
8. Run `curl -X POST http://localhost:3000/api/trades/execute`.
9. Check latest signals with `curl 'http://localhost:3000/api/signals/latest?limit=10'`.
10. Check portfolio with `curl http://localhost:3000/api/trades/portfolio`.
11. If persistence errors return, confirm both service-role SQL patches are applied in Supabase.

## Guardrails

- Do not add product features while validating runtime infrastructure.
- Keep database fixes minimal and related to current backend access paths.
- Do not expose secrets from `.env`.
- Do not reintroduce Anthropic `thinking` when `tool_choice` forces tool use.
- Treat external data-source failures separately from DB and runtime failures.
