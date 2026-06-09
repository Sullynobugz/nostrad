import axios from "axios";
import { callWithTool } from "../services/anthropic";
import { getCandles, getCryptoCandles } from "../services/finnhub";
import type { KronosInput, KronosEngineOutput, KronosMode, OHLCV } from "../types";

const CRYPTO_ASSETS = new Set(["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX"]);

// Kronos Engine — drei Modi:
// mock   → schnelle Entwicklung ohne API-Calls
// native → LLM-basierte Candlestick-Analyse (Kronos-Stil, läuft sofort)
// python → externer Kronos Python-Server
export async function runKronosEngine(
  symbol: string,
  overrideMode?: KronosMode
): Promise<KronosEngineOutput> {
  const mode = (overrideMode || process.env.KRONOS_MODE || "native") as KronosMode;

  switch (mode) {
    case "mock":
      return mockKronos(symbol);
    case "python":
      return pythonKronos(symbol);
    case "native":
    default:
      return nativeKronos(symbol);
  }
}

// ── MOCK-Modus ────────────────────────────────────────────────
function mockKronos(symbol: string): KronosEngineOutput {
  const directions = ["bullish", "bearish", "neutral"] as const;
  const direction = directions[Math.floor(Math.random() * 3)];
  return {
    kronos_direction: direction,
    kronos_score: Math.floor(Math.random() * 40) + 40, // 40-80
    confidence: Math.floor(Math.random() * 30) + 50,   // 50-80
    horizon: "24h",
    reasoning: `[MOCK] ${symbol}: ${direction} Signal basierend auf zufälligen Testdaten`,
    mode: "mock",
  };
}

// ── PYTHON-Modus (echter Kronos Foundation Model) ────────────
// Kronos gibt tatsächliche Preisvorhersagen zurück (trainiert auf 45 Börsen).
// Der FastAPI-Service berechnet daraus direction/score/confidence.
async function pythonKronos(symbol: string): Promise<KronosEngineOutput> {
  const url = process.env.KRONOS_PYTHON_URL || "http://localhost:5001/predict";
  let candles: OHLCV[];

  try {
    candles = await fetchCandles(symbol);
  } catch (err) {
    console.warn(`Candles für ${symbol} nicht ladbar, falle auf native zurück:`, (err as Error).message);
    return nativeKronos(symbol);
  }

  if (candles.length < 10) {
    console.warn(`Zu wenige Candles (${candles.length}) für Kronos, falle auf native zurück`);
    return nativeKronos(symbol);
  }

  try {
    const { data } = await axios.post(
      url,
      { symbol, candles },
      { timeout: 60000 }  // Kronos kann auf CPU etwas dauern
    );

    return {
      kronos_direction: data.kronos_direction || "neutral",
      kronos_score:     data.kronos_score     ?? 50,
      confidence:       data.confidence       ?? 50,
      horizon:          data.horizon          || "24h",
      reasoning:        data.reasoning        || "Kronos Foundation Model",
      mode: "python",
    };
  } catch (err) {
    console.warn("Kronos Python-Service nicht erreichbar, falle auf native zurück:", (err as Error).message);
    return nativeKronos(symbol);
  }
}

// ── NATIVE-Modus (LLM-basierte Zeitreihenanalyse im Kronos-Stil) ──
async function nativeKronos(symbol: string): Promise<KronosEngineOutput> {
  let candles: OHLCV[];
  try {
    candles = await fetchCandles(symbol);
  } catch (err) {
    console.warn(`Konnte Candles für ${symbol} nicht laden, nutze Mock:`, (err as Error).message);
    return mockKronos(symbol);
  }

  if (candles.length < 5) {
    return mockKronos(symbol);
  }

  const candleText = formatCandlesForLLM(candles.slice(-30)); // Letzte 30 Kerzen
  const technicalIndicators = calculateIndicators(candles);

  const systemPrompt = `Du bist ein quantitativer Zeitreihenanalyst spezialisiert auf Finanzmarkt-Prognosen.
Du analysierst OHLCV-Candlestick-Daten und technische Indikatoren um kurzfristige Preisbewegungen vorherzusagen.
Dein Ansatz ist dem Kronos-Framework ähnlich: Du nutzt Pattern-Matching auf Zeitreihendaten kombiniert mit statistischen Merkmalen.

Achte besonders auf:
- Trend-Richtung (Simple Moving Averages, Preis-Momentum)
- Volatilität (ATR-ähnliche Schwankungsbreite)
- Volumen-Trends (steigendes Volumen = stärkeres Signal)
- Candlestick-Patterns (Doji, Engulfing, Hammer etc.)
- RSI-approximierter Overbought/Oversold-Status
- Support/Resistance Levels

Confidence ist eine kalibrierte Wahrscheinlichkeit deiner Prognose, nicht die Trading-Schwelle.
Nutze keine Default-Confidence wie 65. Gib niedrige Werte (40-60) bei gemischter Evidenz,
mittlere Werte (61-74) bei brauchbarer aber unsicherer Evidenz und hohe Werte (75-90)
nur bei klarer Konvergenz mehrerer Indikatoren.`;

  const userMessage = `Analysiere die folgenden Candlestick-Daten für ${symbol}:

CANDLESTICK-DATEN (letzte 30 Tage, Tageskerzen):
${candleText}

TECHNISCHE INDIKATOREN:
${JSON.stringify(technicalIndicators, null, 2)}

Erstelle eine Preis-Prognose für die nächsten 24 Stunden und rufe das Tool predict_price_direction auf.`;

  try {
    return await callWithTool<KronosEngineOutput>({
      systemPrompt,
      userMessage,
      toolName: "predict_price_direction",
      toolDescription: "Sagt die Preisbewegung eines Assets für die nächsten 24h vorher",
      inputSchema: {
        type: "object" as const,
        properties: {
          kronos_direction: {
            type: "string",
            enum: ["bullish", "bearish", "neutral"],
            description: "Vorhergesagte Preisbewegungsrichtung",
          },
          kronos_score: {
            type: "integer",
            minimum: 0,
            maximum: 100,
            description: "Stärke des Signals (0 = sehr schwach, 100 = sehr stark)",
          },
          confidence: {
            type: "integer",
            minimum: 0,
            maximum: 100,
            description: "Confidence in die Prognose",
          },
          horizon: {
            type: "string",
            description: "Zeithorizont der Prognose (z.B. '24h', '4h', '7d')",
          },
          reasoning: {
            type: "string",
            description: "Begründung basierend auf Chartmustern und Indikatoren (2-3 Sätze)",
          },
          mode: {
            type: "string",
            description: "Immer 'native'",
          },
        },
        required: ["kronos_direction", "kronos_score", "confidence", "horizon", "reasoning", "mode"],
      },
    });
  } catch (err) {
    console.warn("Native Kronos LLM-Fehler:", (err as Error).message);
    return mockKronos(symbol);
  }
}

// ── Hilfsfunktionen ───────────────────────────────────────────

async function fetchCandles(symbol: string): Promise<OHLCV[]> {
  if (CRYPTO_ASSETS.has(symbol.toUpperCase())) {
    // Finnhub Crypto-Symbol: BINANCE:BTCUSDT
    return getCryptoCandles(`BINANCE:${symbol.toUpperCase()}USDT`, 30);
  }
  return getCandles(symbol, 30);
}

function formatCandlesForLLM(candles: OHLCV[]): string {
  return candles
    .map(
      (c) =>
        `${c.date}: O=${c.open.toFixed(2)} H=${c.high.toFixed(2)} L=${c.low.toFixed(2)} C=${c.close.toFixed(2)} V=${(c.volume / 1000).toFixed(0)}K`
    )
    .join("\n");
}

function calculateIndicators(candles: OHLCV[]): Record<string, number | string> {
  if (candles.length < 14) return {};

  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];

  // SMA 7 und 21
  const sma7 = avg(closes.slice(-7));
  const sma21 = avg(closes.slice(-21));

  // Momentum (10-Tage)
  const momentum10 =
    closes.length >= 10
      ? ((last - closes[closes.length - 10]) / closes[closes.length - 10]) * 100
      : 0;

  // ATR-Approximation (Average der High-Low-Ranges)
  const ranges = candles.slice(-14).map((c) => c.high - c.low);
  const atr = avg(ranges);

  // RSI-Approximation (simplified)
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < Math.min(closes.length, 15); i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains.push(diff);
    else losses.push(Math.abs(diff));
  }
  const avgGain = gains.length > 0 ? avg(gains) : 0;
  const avgLoss = losses.length > 0 ? avg(losses) : 0.001;
  const rs = avgGain / avgLoss;
  const rsi = Math.round(100 - 100 / (1 + rs));

  // Volumen-Trend
  const volumes = candles.map((c) => c.volume);
  const volSma5 = avg(volumes.slice(-5));
  const volSma20 = avg(volumes.slice(-20));

  return {
    sma7: Math.round(sma7 * 100) / 100,
    sma21: Math.round(sma21 * 100) / 100,
    sma_trend: sma7 > sma21 ? "bullish (SMA7 > SMA21)" : "bearish (SMA7 < SMA21)",
    rsi: rsi,
    rsi_status: rsi > 70 ? "overbought" : rsi < 30 ? "oversold" : "neutral",
    momentum_10d: `${momentum10.toFixed(2)}%`,
    atr: Math.round(atr * 100) / 100,
    volume_trend: volSma5 > volSma20 * 1.2 ? "steigend" : volSma5 < volSma20 * 0.8 ? "fallend" : "neutral",
    last_close: last,
    prev_close: prev,
    daily_change: `${(((last - prev) / prev) * 100).toFixed(2)}%`,
  };
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
