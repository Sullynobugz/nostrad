import { getCandles, getCryptoCandles } from "../services/finnhub";
import { supabase } from "../services/supabase";
import type { DbPaperTrade, DbSignal, OHLCV } from "../types";

const CRYPTO_ASSETS = new Set(["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX"]);
const TECH_ASSETS = new Set(["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "COIN", "MSTR", "QQQ"]);
const CRYPTO_GROUP = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "COIN", "MSTR"]);
const METALS_GROUP = new Set(["GLD", "SLV"]);
const RATES_GROUP = new Set(["TLT"]);

export interface EntryFilterResult {
  allowed: boolean;
  reason: string;
}

export async function checkEntryFilters(signal: DbSignal, openTrades: DbPaperTrade[]): Promise<EntryFilterResult> {
  if (String(process.env.ENTRY_FILTERS_ENABLED || "true") !== "true") {
    return { allowed: true, reason: "entry filters disabled" };
  }

  const cooldown = await checkAssetCooldown(signal.asset);
  if (!cooldown.allowed) return cooldown;

  const correlation = checkCorrelationCap(signal, openTrades);
  if (!correlation.allowed) return correlation;

  const [regime, setup] = await Promise.all([
    getMarketRegime(),
    getAssetSetup(signal.asset),
  ]);

  const regimeGate = checkRegimeGate(signal, regime);
  if (!regimeGate.allowed) return regimeGate;

  const setupGate = checkSetupGate(signal, setup);
  if (!setupGate.allowed) return setupGate;

  return { allowed: true, reason: `filters ok (${regime.label}; ${setup.reason})` };
}

async function checkAssetCooldown(asset: string): Promise<EntryFilterResult> {
  const hours = parseFloat(process.env.ENTRY_ASSET_COOLDOWN_HOURS || "12");
  if (hours <= 0) return { allowed: true, reason: "cooldown disabled" };

  const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
  const { data } = await supabase
    .from("paper_trades")
    .select("pnl_absolute, exit_time")
    .eq("asset", asset)
    .eq("status", "closed")
    .gte("exit_time", cutoff)
    .order("exit_time", { ascending: false })
    .limit(1);

  const last = data?.[0];
  if (last && Number(last.pnl_absolute || 0) < 0) {
    return { allowed: false, reason: `Asset cooldown nach Verlust (${asset}, ${hours}h)` };
  }
  return { allowed: true, reason: "cooldown ok" };
}

function checkCorrelationCap(signal: DbSignal, openTrades: DbPaperTrade[]): EntryFilterResult {
  const maxGroup = parseInt(process.env.ENTRY_MAX_CORRELATED_POSITIONS || "4", 10);
  if (maxGroup <= 0) return { allowed: true, reason: "correlation cap disabled" };

  const group = assetGroup(signal.asset);
  if (group === "other") return { allowed: true, reason: "correlation ok" };

  const sameGroup = openTrades.filter((trade) => assetGroup(trade.asset) === group).length;
  if (sameGroup >= maxGroup) {
    return { allowed: false, reason: `Correlation cap ${group} erreicht (${sameGroup}/${maxGroup})` };
  }
  return { allowed: true, reason: "correlation ok" };
}

function checkRegimeGate(signal: DbSignal, regime: { label: string; riskOnScore: number }): EntryFilterResult {
  const strictness = process.env.ENTRY_REGIME_STRICTNESS || "balanced";
  if (strictness === "off") return { allowed: true, reason: "regime disabled" };

  if (signal.final_direction === "long" && regime.riskOnScore <= -2 && signal.final_score < 78) {
    return { allowed: false, reason: `Risk-off Regime blockt Long (${regime.label})` };
  }

  if (signal.final_direction === "short" && regime.riskOnScore >= 2 && signal.final_score < 78) {
    return { allowed: false, reason: `Risk-on Regime blockt Short (${regime.label})` };
  }

  return { allowed: true, reason: "regime ok" };
}

function checkSetupGate(signal: DbSignal, setup: AssetSetup): EntryFilterResult {
  const minVolumeSpike = parseFloat(process.env.ENTRY_MIN_VOLUME_SPIKE || "0.75");
  const maxExtensionAtr = parseFloat(process.env.ENTRY_MAX_EXTENSION_ATR || "2.8");

  if (setup.volumeSpike < minVolumeSpike && signal.final_score < 75) {
    return { allowed: false, reason: `Volumen zu schwach (${setup.volumeSpike.toFixed(2)}x < ${minVolumeSpike})` };
  }

  if (signal.final_direction === "long" && setup.trend === "bearish" && signal.final_score < 78) {
    return { allowed: false, reason: `Long gegen Asset-Downtrend (${setup.reason})` };
  }

  if (signal.final_direction === "short" && setup.trend === "bullish" && signal.final_score < 78) {
    return { allowed: false, reason: `Short gegen Asset-Uptrend (${setup.reason})` };
  }

  if (signal.final_direction === "long" && setup.extensionAtr > maxExtensionAtr) {
    return { allowed: false, reason: `Long overextended (${setup.extensionAtr.toFixed(2)} ATR über SMA21)` };
  }

  if (signal.final_direction === "short" && setup.extensionAtr < -maxExtensionAtr) {
    return { allowed: false, reason: `Short overextended (${Math.abs(setup.extensionAtr).toFixed(2)} ATR unter SMA21)` };
  }

  return { allowed: true, reason: `setup ok (${setup.reason})` };
}

async function getMarketRegime(): Promise<{ label: string; riskOnScore: number }> {
  const assets = ["SPY", "QQQ", "BTC"];
  const setups = await Promise.all(assets.map((asset) => getAssetSetup(asset)));
  const riskOnScore = setups.reduce((sum, setup) => sum + (setup.trend === "bullish" ? 1 : setup.trend === "bearish" ? -1 : 0), 0);
  const label = riskOnScore >= 2 ? "risk-on" : riskOnScore <= -2 ? "risk-off" : "neutral";
  return { label, riskOnScore };
}

interface AssetSetup {
  trend: "bullish" | "bearish" | "neutral";
  volumeSpike: number;
  extensionAtr: number;
  reason: string;
}

async function getAssetSetup(asset: string): Promise<AssetSetup> {
  try {
    const candles = await fetchCandles(asset, 45);
    if (candles.length < 21) return { trend: "neutral", volumeSpike: 1, extensionAtr: 0, reason: "zu wenige Candles" };

    const closes = candles.map((c) => c.close);
    const last = closes[closes.length - 1];
    const sma7 = avg(closes.slice(-7));
    const sma21 = avg(closes.slice(-21));
    const atr = avg(candles.slice(-14).map((c) => c.high - c.low)) || last * 0.02;
    const trend = sma7 > sma21 * 1.002 ? "bullish" : sma7 < sma21 * 0.998 ? "bearish" : "neutral";
    const volumeSpike = calculateVolumeSpike(candles);
    const extensionAtr = atr ? (last - sma21) / atr : 0;

    return {
      trend,
      volumeSpike,
      extensionAtr,
      reason: `${trend}, vol=${volumeSpike.toFixed(2)}x, ext=${extensionAtr.toFixed(2)}ATR`,
    };
  } catch (err) {
    return { trend: "neutral", volumeSpike: 1, extensionAtr: 0, reason: `setup fallback: ${(err as Error).message}` };
  }
}

async function fetchCandles(asset: string, days: number): Promise<OHLCV[]> {
  const normalized = asset.toUpperCase();
  return CRYPTO_ASSETS.has(normalized)
    ? getCryptoCandles(`BINANCE:${normalized}USDT`, days)
    : getCandles(normalized, days);
}

function assetGroup(asset: string): string {
  const normalized = asset.toUpperCase();
  if (CRYPTO_GROUP.has(normalized)) return "crypto";
  if (TECH_ASSETS.has(normalized)) return "tech";
  if (METALS_GROUP.has(normalized)) return "metals";
  if (RATES_GROUP.has(normalized)) return "rates";
  return "other";
}

function calculateVolumeSpike(candles: OHLCV[]): number {
  const volumes = candles.map((c) => c.volume || 0);
  const last = volumes[volumes.length - 1] || 0;
  const base = avg(volumes.slice(-21, -1).filter((v) => v > 0));
  return base ? last / base : 1;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
