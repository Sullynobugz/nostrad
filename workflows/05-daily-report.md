# Workflow 05 — Daily Report

**Trigger:** Schedule — täglich 08:00 Uhr
**Ziel:** Tagesüberblick erstellen und optional als Telegram-Nachricht senden

## n8n Node-Konfiguration

```
[Schedule Trigger]
  → Täglich 08:00 Uhr

[HTTP Request: Generate Markdown Report]
  Method: GET
  URL: http://localhost:3000/api/reports/daily/markdown
  Timeout: 30s

[IF: Telegram konfiguriert]
  Condition: TELEGRAM_BOT_TOKEN !== ""

  → True: [Telegram: Send Message]
    Bot Token: {{ $env.TELEGRAM_BOT_TOKEN }}
    Chat ID:   {{ $env.TELEGRAM_CHAT_ID }}
    Text: "📊 *Nostrad Daily Report*\n{{ $json.body.slice(0, 3000) }}"
    Parse Mode: Markdown

  → False: [Log Report]
    Report wird nur als Datei gespeichert unter /reports/report-DATUM.md
```

## Telegram-Setup (optional)

1. BotFather: `/newbot` → API Token
2. Einmal dem Bot schreiben, dann Chat-ID ermitteln:
   `https://api.telegram.org/bot{TOKEN}/getUpdates`
3. Token und Chat-ID in `.env` eintragen

## Report-Inhalt

- Portfolio Equity + PnL
- Heute geschlossene Trades
- Win Rate des Tages
- Bester / schlechtester Trade
- Engine Performance Ranking
- Top Assets
