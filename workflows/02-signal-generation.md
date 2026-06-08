# Workflow 02 — Signal Generation

**Trigger:** Schedule — alle 30 Minuten (nach Data Ingestion)
**Ziel:** Unverarbeitete Events zu Signalen verarbeiten

## n8n Node-Konfiguration

```
[Schedule Trigger]
  → 30 Minuten Intervall (versetzt: :05 und :35)

[HTTP Request: Process Queue]
  Method: POST
  URL: http://localhost:3000/api/signals/process-queue
  Timeout: 300s  ← LLM-Calls dauern länger

[IF: Signals Generated]
  Condition: {{ $json.processed }} > 0

  → True: [HTTP Request: Execute Signals]
    Method: POST
    URL: http://localhost:3000/api/trades/execute

  → False: [No-Op / Log "Keine neuen Events"]
```

## Erwarteter Response (process-queue)

```json
{
  "success": true,
  "processed": 3,
  "results": [
    {
      "event_id": "uuid-...",
      "asset": "BTC",
      "success": true,
      "signal_id": "uuid-..."
    }
  ]
}
```

## Wichtig

- Timeout auf 300s setzen — 4 LLM-Calls pro Event (Event + Sentiment + Kronos + Final)
- Rate Limiting: Maximal 10 Events pro Durchlauf (bereits im Backend begrenzt)
- Signale mit score < 65 oder confidence < 65 werden automatisch übersprungen
