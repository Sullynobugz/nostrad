# Workflow 03 — Paper Trade Executor

**Trigger:** Schedule — alle 10 Minuten
**Ziel:** Pending Signale prüfen und Trades eröffnen

## n8n Node-Konfiguration

```
[Schedule Trigger]
  → 10 Minuten Intervall

[HTTP Request: Execute Pending Signals]
  Method: POST
  URL: http://localhost:3000/api/trades/execute
  Timeout: 30s

[IF: Trades Executed]
  Condition: {{ $json.executed }} > 0

  → True: [Log / Notification]
    "{{ $json.executed }} Trades eröffnet"
    Details: {{ $json.details.join('\n') }}
```

## Handelsregeln (konfigurierbar in .env)

- `PAPER_TRADING_MIN_FINAL_SCORE=65` — Mindest-Score für Trade
- `PAPER_TRADING_MIN_CONFIDENCE=65` — Mindest-Confidence
- `PAPER_TRADING_MAX_POSITION=100` — Max. Positionsgröße in €
- Pro Asset maximal 1 offener Trade gleichzeitig
