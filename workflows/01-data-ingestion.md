# Workflow 01 — Data Ingestion

**Trigger:** Schedule — alle 15 Minuten
**Ziel:** RSS, Reddit und Finnhub News holen, deduplizieren, als Events speichern

## n8n Node-Konfiguration

```
[Schedule Trigger]
  → 15 Minuten Intervall

[HTTP Request: Ingest Run]
  Method: POST
  URL: http://localhost:3000/api/ingest/run
  Headers: { Content-Type: application/json }
  Timeout: 120s

[IF: Success Check]
  Condition: {{ $json.success }} === true

  → True: [Set: Log]
    Message: "Ingestion OK — Inserted: {{ $json.inserted }}, Duplicates: {{ $json.duplicates }}"

  → False: [Error Notification]
    (Optional: Telegram oder E-Mail)
```

## Erwarteter Response

```json
{
  "success": true,
  "inserted": 12,
  "duplicates": 8,
  "errors": [],
  "sources": {
    "rss": 45,
    "reddit": 38,
    "finnhub": 20
  }
}
```

## Fehlerbehandlung

- Timeout: 120s (RSS-Feeds können langsam sein)
- Bei HTTP 500: Nicht erneut versuchen, einfach warten bis zum nächsten Durchlauf
- Fehler werden in `errors`-Array zurückgegeben und geloggt
