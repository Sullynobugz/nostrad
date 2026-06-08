# Workflow 04 — Trade Closer

**Trigger:** Schedule — stündlich
**Ziel:** Trades die älter als 24h sind schließen, PnL berechnen

## n8n Node-Konfiguration

```
[Schedule Trigger]
  → Stündlich (z.B. :00 jede Stunde)

[HTTP Request: Close Expired Trades]
  Method: POST
  URL: http://localhost:3000/api/trades/close-expired
  Timeout: 60s

[IF: Trades Closed]
  Condition: {{ $json.closed }} > 0

  → True: [Portfolio Snapshot]
    Method: POST
    URL: http://localhost:3000/api/trades/snapshot

  → False: [No-Op]

[Log Result]
  "{{ $json.closed }} Trades geschlossen | PnL: {{ $json.pnl_total }}€"
  Details: {{ $json.details.join('\n') }}
```

## Wichtig

- Trades werden zum aktuellen Finnhub-Marktpreis geschlossen
- Bei API-Fehler (Markt geschlossen): Trade bleibt offen bis zum nächsten Versuch
- Nach jeder Schließung wird automatisch ein Portfolio-Snapshot erstellt
- `PAPER_TRADING_HOLD_HOURS=24` — konfigurierbare Haltedauer
