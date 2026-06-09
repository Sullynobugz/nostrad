import { getCandles, getCryptoCandles } from "../services/finnhub";
import type { OHLCV } from "../types";

const CRYPTO_ASSETS = new Set(["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX"]);

export interface PreScreenResult {
  asset: string;
  direction: "bullish" | "bearish" | "neutral";
  score: number;
  reason: string;
  force_review: boolean;
}

export async function runPreScreen(asset: string): Promise<PreScreenResult> {
  try {
    const candles = await fetchCandles(asset, 45);
    if (candles.length < 21) return fallback(asset, "zu wenige Candles");

    const closes = candles.map((c) => c.close);
    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const sma7 = avg(closes.slice(-7));
    const sma21 = avg(closes.slice(-21));
    const momentum5 = pct(last, closes[closes.length - 6] ?? prev);
    const momentum10 = pct(last, closes[closes.length - 11] ?? prev);
    const daily = pct(last, prev);
    const rsi = calculateRsi(closes.slice(-15));
    const atrPercent = calculateAtrPercent(candles.slice(-15));
    const volumeSpike = calculateVolumeSpike(candles);

    const bullishPoints = [
      sma7 > sma21 ? 18 : 0,
      momentum5 > 1.5 ? 16 : momentum5 > 0 ? 8 : 0,
      momentum10 > 3 ? 16 : momentum10 > 0 ? 8 : 0,
      daily > 1 ? 10 : daily > 0 ? 5 : 0,
      volumeSpike > 1.25 && daily > 0 ? 12 : 0,
      rsi >= 45 && rsi <= 72 ? 8 : 0,
      atrPercent >= 1 && atrPercent <= 8 ? 6 : 0,
    ].reduce((sum, value) => sum + value, 0);

    const bearishPoints = [
      sma7 < sma21 ? 18 : 0,
      momentum5 < -1.5 ? 16 : momentum5 < 0 ? 8 : 0,
      momentum10 < -3 ? 16 : momentum10 < 0 ? 8 : 0,
      daily < -1 ? 10 : daily < 0 ? 5 : 0,
      volumeSpike > 1.25 && daily < 0 ? 12 : 0,
      rsi >= 28 && rsi <= 55 ? 8 : 0,
      atrPercent >= 1 && atrPercent <= 8 ? 6 : 0,
    ].reduce((sum, value) => sum + value, 0);

    const direction = bullishPoints >= bearishPoints + 8
      ? "bullish"
      : bearishPoints >= bullishPoints + 8
      ? "bearish"
      : "neutral";
    const score = Math.max(bullishPoints, bearishPoints);
    const forceReview = score >= 68 || Math.abs(momentum10) >= 8 || volumeSpike >= 1.8;

    return {
      asset,
      direction,
      score,
      force_review: forceReview,
      reason:
        `pre=${score}, dir=${direction}, sma7=${sma7.toFixed(2)}, sma21=${sma21.toFixed(2)}, ` +
        `mom5=${momentum5.toFixed(2)}%, mom10=${momentum10.toFixed(2)}%, rsi=${rsi}, atr=${atrPercent.toFixed(2)}%, vol=${volumeSpike.toFixed(2)}x`,
    };
  } catch (err) {
    return fallback(asset, (err as Error).message);
  }
}

async function fetchCandles(asset: string, days: number): Promise<OHLCV[]> {
  const normalized = asset.toUpperCase();
  return CRYPTO_ASSETS.has(normalized)
    ? getCryptoCandles(`BINANCE:${normalized}USDT`, days)
    : getCandles(normalized, days);
}

function fallback(asset: string, reason: string): PreScreenResult {
  return { asset, direction: "neutral", score: 0, reason, force_review: false };
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pct(current: number, previous: number): number {
  if (!previous) return 0;
  return ((current - previous) / previous) * 100;
}

function calculateRsi(closes: number[]): number {
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return Math.round(100 - 100 / (1 + rs));
}

function calculateAtrPercent(candles: OHLCV[]): number {
  if (candles.length < 2) return 0;
  const ranges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }
  const last = candles[candles.length - 1].close;
  return last ? (avg(ranges) / last) * 100 : 0;
}

function calculateVolumeSpike(candles: OHLCV[]): number {
  const volumes = candles.map((c) => c.volume || 0);
  const last = volumes[volumes.length - 1] || 0;
  const base = avg(volumes.slice(-21, -1).filter((v) => v > 0));
  return base ? last / base : 1;
}
