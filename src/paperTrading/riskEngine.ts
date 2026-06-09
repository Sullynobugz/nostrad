import { getCandles, getCryptoCandles } from "../services/finnhub";
import type { DbPaperTrade, OpenPaperTrade, OHLCV } from "../types";

const CRYPTO_ASSETS = new Set(["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX"]);

export interface AdaptiveRiskConfig {
  atrPeriod: number;
  stopAtrMultiplier: number;
  rewardRiskRatio: number;
  trailingStartR: number;
  trailingAtrMultiplier: number;
  fallbackTakeProfitPercent: number;
  fallbackStopLossPercent: number;
}

export interface AdaptiveRiskPlan {
  atr_percent: number | null;
  stop_loss_percent: number;
  take_profit_percent: number;
  trailing_start_percent: number;
  trailing_stop_percent: number;
  max_favorable_move_percent: number | null;
  source: "adaptive" | "fallback";
}

export function getAdaptiveRiskConfig(input: {
  fallbackTakeProfitPercent: number;
  fallbackStopLossPercent: number;
}): AdaptiveRiskConfig {
  const stopAtrMultiplier = parseFloat(process.env.PAPER_TRADING_STOP_ATR_MULTIPLIER || "1.2");
  const rewardRiskRatio = parseFloat(process.env.PAPER_TRADING_REWARD_RISK_RATIO || "2");
  const trailingStartR = parseFloat(process.env.PAPER_TRADING_TRAILING_START_R || "1");
  const trailingAtrMultiplier = parseFloat(process.env.PAPER_TRADING_TRAILING_ATR_MULTIPLIER || "0.9");
  const atrPeriod = parseInt(process.env.PAPER_TRADING_ATR_PERIOD || "14", 10);

  return {
    atrPeriod,
    stopAtrMultiplier,
    rewardRiskRatio,
    trailingStartR,
    trailingAtrMultiplier,
    fallbackTakeProfitPercent: input.fallbackTakeProfitPercent,
    fallbackStopLossPercent: input.fallbackStopLossPercent,
  };
}

export async function buildAdaptiveRiskPlan(
  asset: string,
  config: AdaptiveRiskConfig,
  trade?: DbPaperTrade
): Promise<AdaptiveRiskPlan> {
  try {
    const candles = await fetchRiskCandles(asset, Math.max(config.atrPeriod + 10, 30));
    const atrPercent = calculateAtrPercent(candles, config.atrPeriod);
    if (!atrPercent || !Number.isFinite(atrPercent)) return fallbackPlan(config);

    const stopLossPercent = clamp(atrPercent * config.stopAtrMultiplier, 1.2, 12);
    const takeProfitPercent = clamp(stopLossPercent * config.rewardRiskRatio, stopLossPercent * 1.2, 30);
    const trailingStartPercent = stopLossPercent * config.trailingStartR;
    const trailingStopPercent = clamp(atrPercent * config.trailingAtrMultiplier, 0.8, stopLossPercent);

    return {
      atr_percent: round2(atrPercent),
      stop_loss_percent: round2(stopLossPercent),
      take_profit_percent: round2(takeProfitPercent),
      trailing_start_percent: round2(trailingStartPercent),
      trailing_stop_percent: round2(trailingStopPercent),
      max_favorable_move_percent: trade ? calculateMaxFavorableMovePercent(trade, candles) : null,
      source: "adaptive",
    };
  } catch {
    return fallbackPlan(config);
  }
}

export function getAdaptiveRiskExitReason(
  trade: DbPaperTrade,
  markedTrade: OpenPaperTrade,
  plan: AdaptiveRiskPlan
): string | null {
  const pnlPercent = markedTrade.unrealized_pnl_percent;
  const currentPrice = markedTrade.current_price;
  if (pnlPercent == null || currentPrice == null) return null;

  if (pnlPercent >= plan.take_profit_percent) {
    return `Adaptive Take-Profit erreicht (${pnlPercent.toFixed(2)}% >= ${plan.take_profit_percent}%, ATR=${formatAtr(plan)})`;
  }

  if (pnlPercent <= -plan.stop_loss_percent) {
    return `Adaptive Stop-Loss erreicht (${pnlPercent.toFixed(2)}% <= -${plan.stop_loss_percent}%, ATR=${formatAtr(plan)})`;
  }

  const favorableMove =
    plan.max_favorable_move_percent ??
    (trade.direction === "long"
      ? ((currentPrice - trade.entry_price) / trade.entry_price) * 100
      : ((trade.entry_price - currentPrice) / trade.entry_price) * 100);

  if (favorableMove >= plan.trailing_start_percent) {
    const givebackFromBest = Math.max(0, favorableMove - pnlPercent);
    if (givebackFromBest >= plan.trailing_stop_percent) {
      return `Adaptive Trailing-Stop (${givebackFromBest.toFixed(2)}% Giveback >= ${plan.trailing_stop_percent}%, ATR=${formatAtr(plan)})`;
    }
  }

  return null;
}

function fallbackPlan(config: AdaptiveRiskConfig): AdaptiveRiskPlan {
  const stopLossPercent = config.fallbackStopLossPercent;
  return {
    atr_percent: null,
    stop_loss_percent: stopLossPercent,
    take_profit_percent: config.fallbackTakeProfitPercent,
    trailing_start_percent: stopLossPercent,
    trailing_stop_percent: stopLossPercent,
    max_favorable_move_percent: null,
    source: "fallback",
  };
}

async function fetchRiskCandles(asset: string, days: number): Promise<OHLCV[]> {
  const normalized = asset.toUpperCase();
  return CRYPTO_ASSETS.has(normalized)
    ? getCryptoCandles(`BINANCE:${normalized}USDT`, days)
    : getCandles(normalized, days);
}

function calculateAtrPercent(candles: OHLCV[], period: number): number | null {
  if (candles.length < period + 1) return null;
  const recent = candles.slice(-(period + 1));
  const trueRanges: number[] = [];

  for (let i = 1; i < recent.length; i++) {
    const current = recent[i];
    const previous = recent[i - 1];
    const range = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
    trueRanges.push(range);
  }

  const lastClose = recent[recent.length - 1].close;
  if (!lastClose) return null;
  const atr = trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length;
  return (atr / lastClose) * 100;
}

function calculateMaxFavorableMovePercent(trade: DbPaperTrade, candles: OHLCV[]): number | null {
  const entryDate = trade.entry_time.split("T")[0];
  const sinceEntry = candles.filter((c) => c.date >= entryDate);
  if (sinceEntry.length === 0) return null;

  const bestPrice = trade.direction === "long"
    ? Math.max(...sinceEntry.map((c) => c.high))
    : Math.min(...sinceEntry.map((c) => c.low));

  const move = trade.direction === "long"
    ? ((bestPrice - trade.entry_price) / trade.entry_price) * 100
    : ((trade.entry_price - bestPrice) / trade.entry_price) * 100;

  return round2(Math.max(0, move));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatAtr(plan: AdaptiveRiskPlan): string {
  return plan.atr_percent == null ? "fallback" : `${plan.atr_percent}%`;
}
