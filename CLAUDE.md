# Nostrad — CLAUDE.md

## Was diese App ist
Persönliches Paper-Trading-Research-System. Testet mit virtuellem Kapital (1.000€), ob die Kombination aus vier Engines (Event-Analyse, Sentiment, Polymarket + Kronos-Zeitreihenanalyse) bessere Marktentscheidungen trifft als Zufall. Kein SaaS, kein Auth, kein Echtgeld.

**Status**: Aktiv — MVP in Entwicklung

## Was gerade wirklich läuft
Backend läuft lokal auf Port 3000. Alle API-Keys gesetzt. Supabase-Schema deployed + Reset-Permissions migriert. Kronos-Only-Modus aktiv (`KRONOS_MODE=native`). Coolify-Deploy noch ausstehend (Repo war private → SSH-Auth-Fehler, Fix: kurz public machen → deployen → wieder private + Deploy Key eintragen).

## Tech Stack
- **Backend:** TypeScript + Express (Node.js)
- **Datenbank:** Supabase (PostgreSQL)
- **LLM:** Claude Opus 4.7 via `@anthropic-ai/sdk` (Engines: Event, Sentiment, Final Signal, Kronos-native)
- **Dashboard:** React + Vite + Tailwind + lightweight-charts (TradingView)
- **Orchestrierung:** n8n (5 Workflows)
- **Datenquellen:** Finnhub, Polymarket CLOB API, Reddit JSON API, RSS-Feeds

## Projektstruktur

```
/nostrad
  /src
    /engines          ← 5 Signal-Engines
      eventEngine.ts          (LLM: Claude Opus 4.7)
      sentimentEngine.ts      (LLM: Claude Opus 4.7)
      polymarketEngine.ts     (keine LLM, direkte API)
      kronosEngine.ts         (LLM, 3 Modi: mock|native|python)
      finalSignalEngine.ts    (LLM: kombiniert alle 4)
    /services         ← API-Clients
      anthropic.ts            (callWithTool Helfer)
      supabase.ts
      finnhub.ts              (Preis + OHLCV)
      polymarket.ts           (CLOB + Gamma API)
      reddit.ts               (JSON API, kein Auth)
      rss.ts                  (9 RSS-Feeds)
    /paperTrading
      executor.ts             (Signal → Trade)
      closer.ts               (Trade schließen nach 24h)
      portfolio.ts            (Kassenstand, Snapshots)
    /routes           ← Express API
      ingest.ts               (/api/ingest/*)
      signals.ts              (/api/signals/*)
      trades.ts               (/api/trades/*)
      reports.ts              (/api/reports/*)
    /prompts          ← LLM Prompt-Templates
    /reports          ← Daily Report Generator
    /types            ← Zentrale TypeScript-Typen
    index.ts          ← Express-Server (Port 3000)
  /apps/dashboard     ← React Trading Terminal UI
  /supabase
    migrations.sql    ← Schema + Indices + Views
  /workflows          ← n8n Workflow-Spezifikationen (MD)
  .env.example
```

## Dev-Befehle

```bash
# Backend
cd /Users/sully/projects/nostrad
npm install
cp .env.example .env  # API-Keys eintragen
npm run dev           # Port 3000

# Dashboard (separates Terminal)
cd apps/dashboard
npm install
npm run dev           # Port 5173, proxied zu :3000

# Supabase Migration
# → SQL aus supabase/migrations.sql in Supabase SQL Editor ausführen

# Manuell
npm run close-trades    # Abgelaufene Trades schließen
npm run daily-report    # Report generieren
```

## Nächste Schritte

1. **Coolify Deploy** — Repo kurz auf Public → Deploy klicken → danach wieder Private
2. **Deploy Key** einrichten: `ssh root@167.233.30.113 "cat /root/.ssh/id_rsa.pub"` → in GitHub → nostrad → Settings → Deploy keys (ohne Write Access)
3. **n8n Workflow importieren** — `workflows/n8n-import-nostrad.json` in n8n laden, HOST durch Coolify-URL ersetzen, aktivieren
4. **Kronos python-Modus** (optional, später): Kronos-Service als zweiten Coolify-Service deployen → `KRONOS_MODE=python`

## API Keys benötigt

| Service | Wo holen | Tier |
|---------|----------|------|
| Anthropic | console.anthropic.com | Pay-as-you-go |
| Supabase | supabase.com | Free |
| Finnhub | finnhub.io | Free (60 Req/Min) |
| Polymarket | Kein Key nötig | — |
| Reddit | Kein Key nötig | — |

## Kronos-Modi

- `KRONOS_MODE=mock` → Zufällige Scores (für lokale Tests ohne API-Keys)
- `KRONOS_MODE=native` → Claude analysiert OHLCV-Daten (Fallback, läuft ohne Python-Service)
- `KRONOS_MODE=python` → **Echtes Kronos Foundation Model** (empfohlen für Produktion)

### Kronos Foundation Model (python-Modus)
Kronos ist ein auf 45 Börsen vortrainiertes Transformer-Modell für Finanzzeitreihen.
Es gibt tatsächliche zukünftige OHLCV-Candles zurück — kein LLM-Opinion-Call.

```bash
# Lokal starten
cd kronos_service
pip install -r requirements.txt
uvicorn app:app --port 5001

# Oder mit Docker
cd nostrad
docker-compose -f kronos_service/docker-compose.yml up
```

**Modellgrössen:**
- `KRONOS_MODEL_SIZE=mini` → 4.1M Params, sehr schnell (CPU-freundlich)
- `KRONOS_MODEL_SIZE=small` → 24.7M Params, Standard (empfohlen für VPS)
- `KRONOS_MODEL_SIZE=base` → 102.3M Params, für Gaming-PC mit GPU

**Coolify-Deployment:** `kronos_service/Dockerfile` als neuer Service in Coolify anlegen.
HuggingFace-Cache per Volume persistent machen (kein Re-Download bei Neustart).

## Paper Trading Regeln

- Startkapital: 1.000€ (einmalig per Supabase Migration gesetzt)
- Max. Position: 100€ pro Trade
- Trade wenn: `final_score >= 65` AND `confidence >= 65`
- Exit: automatisch nach 24h zum aktuellen Marktpreis
- Pro Asset: max. 1 offener Trade gleichzeitig

## Entwicklungslog

| Datum | Was & Warum |
|-------|-------------|
| 2026-06-08 | MVP erstellt: 4 Engines, Supabase Schema, Express API, React Dashboard, 5 n8n Workflow-Specs |
