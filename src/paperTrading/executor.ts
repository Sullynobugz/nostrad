import { supabase } from "../services/supabase";
import { getQuote } from "../services/finnhub";
import { getPortfolioState, updateCashBalance } from "./portfolio";
import { checkEntryFilters } from "./entryFilterEngine";
import type { DbSignal, DbPaperTrade, Direction } from "../types";

const MAX_POSITION = parseFloat(process.env.PAPER_TRADING_MAX_POSITION || "100");
const MIN_FINAL_SCORE = parseInt(process.env.PAPER_TRADING_MIN_FINAL_SCORE || "65");
const MIN_CONFIDENCE = parseInt(process.env.PAPER_TRADING_MIN_CONFIDENCE || "65");
const MAX_OPEN_POSITIONS = parseInt(process.env.PAPER_TRADING_MAX_OPEN_POSITIONS || "5", 10);
const MAX_EXPOSURE_PERCENT = parseFloat(process.env.PAPER_TRADING_MAX_EXPOSURE_PERCENT || "60");
const MAX_DAILY_LOSS_PERCENT = parseFloat(process.env.PAPER_TRADING_MAX_DAILY_LOSS_PERCENT || "3");
const MAX_CONSECUTIVE_LOSSES = parseInt(process.env.PAPER_TRADING_MAX_CONSECUTIVE_LOSSES || "3", 10);
const POLITICAL_CONFIRMATION_MIN_KRONOS = parseInt(process.env.POLITICAL_CONFIRMATION_MIN_KRONOS || "65", 10);
const CRYPTO_ASSETS = new Set(["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX"]);

// Prüft pending Signale und öffnet Trades wenn Kriterien erfüllt
export async function executePendingSignals(): Promise<{
  executed: number;
  skipped: number;
  details: string[];
}> {
  return executePendingSignalsInternal({
    demoMode: false,
    limit: undefined,
    signalIds: undefined,
  });
}

export async function executeSignalIds(signalIds: string[]): Promise<{
  executed: number;
  skipped: number;
  details: string[];
}> {
  return executePendingSignalsInternal({
    demoMode: false,
    limit: undefined,
    signalIds,
  });
}

export async function executeDemoSignals(limit = 3): Promise<{
  executed: number;
  skipped: number;
  details: string[];
}> {
  return executePendingSignalsInternal({
    demoMode: true,
    limit,
    signalIds: undefined,
  });
}

async function executePendingSignalsInternal(options: {
  demoMode: boolean;
  limit?: number;
  signalIds?: string[];
}): Promise<{
  executed: number;
  skipped: number;
  details: string[];
}> {
  let query = supabase
    .from("signals")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (options.signalIds?.length) {
    query = query.in("id", options.signalIds);
  }

  const { data: signals, error } = await query;

  if (error) throw new Error(`Signals-Fetch fehlgeschlagen: ${error.message}`);
  if (!signals || signals.length === 0) {
    return { executed: 0, skipped: 0, details: ["Keine handelbaren Signale"] };
  }

  const candidateSignals = options.demoMode
    ? (signals as DbSignal[])
        .filter((signal) => signal.final_direction !== "neutral")
        .sort((a, b) => b.final_score - a.final_score || b.confidence - a.confidence)
        .slice(0, options.limit ?? 3)
    : (signals as DbSignal[]);

  if (candidateSignals.length === 0) {
    return { executed: 0, skipped: 0, details: ["Keine handelbaren Signale"] };
  }

  let executed = 0;
  let skipped = 0;
  const details: string[] = [];

  for (const signal of candidateSignals) {
    try {
      if (!options.demoMode && (signal.final_score < MIN_FINAL_SCORE || signal.confidence < MIN_CONFIDENCE)) {
        skipped++;
        const reason = `Schwelle nicht erreicht (score=${signal.final_score}/${MIN_FINAL_SCORE}, confidence=${signal.confidence}/${MIN_CONFIDENCE})`;
        await markSignalSkipped(signal.id, reason);
        details.push(`✗ Übersprungen: ${signal.asset} — ${reason}`);
        continue;
      }

      const result = await executeSingleSignal(signal);
      if (result.success) {
        executed++;
        details.push(`✓ Trade eröffnet: ${signal.asset} ${signal.final_direction} @ ${result.entry_price?.toFixed(2)}`);
      } else {
        skipped++;
        details.push(`✗ Übersprungen: ${signal.asset} — ${result.reason}`);
      }
    } catch (err) {
      skipped++;
      details.push(`✗ Fehler bei ${signal.asset}: ${(err as Error).message}`);
    }
  }

  return { executed, skipped, details };
}

async function executeSingleSignal(signal: DbSignal): Promise<{
  success: boolean;
  entry_price?: number;
  reason?: string;
}> {
  if (signal.final_direction === "neutral") {
    await markSignalSkipped(signal.id, "neutral");
    return { success: false, reason: "Neutrale Richtung — kein Trade" };
  }

  // Kapital prüfen
  const portfolio = await getPortfolioState();
  if (portfolio.cash_balance < MAX_POSITION) {
    await markSignalSkipped(signal.id, "insufficient_capital");
    return { success: false, reason: `Nicht genug Kapital (${portfolio.cash_balance.toFixed(2)}€ < ${MAX_POSITION}€)` };
  }

  const riskGate = await checkPortfolioRiskGates(signal, portfolio.cash_balance);
  if (!riskGate.allowed) {
    await markSignalSkipped(signal.id, riskGate.reason);
    return { success: false, reason: riskGate.reason };
  }

  const entryGate = await checkEntryFilters(signal, riskGate.openTrades);
  if (!entryGate.allowed) {
    await markSignalSkipped(signal.id, entryGate.reason);
    return { success: false, reason: entryGate.reason };
  }

  // Duplikat-Check: Bereits offener Trade für dieses Asset?
  const { data: existingTrade } = await supabase
    .from("paper_trades")
    .select("id")
    .eq("asset", signal.asset)
    .eq("status", "open")
    .maybeSingle();

  if (existingTrade) {
    await markSignalSkipped(signal.id, "duplicate");
    return { success: false, reason: `Bereits offener Trade für ${signal.asset}` };
  }

  // Aktuellen Preis holen
  let entryPrice: number;
  try {
    entryPrice = CRYPTO_ASSETS.has(signal.asset)
      ? await getQuote(`BINANCE:${signal.asset}USDT`)
      : await getQuote(signal.asset);
  } catch {
    try {
      entryPrice = CRYPTO_ASSETS.has(signal.asset)
        ? await getQuote(signal.asset)
        : await getQuote(`BINANCE:${signal.asset}USDT`);
    } catch (err) {
      await markSignalSkipped(signal.id, "price_fetch_failed");
      return { success: false, reason: `Preis nicht verfügbar: ${(err as Error).message}` };
    }
  }

  const direction = signal.final_direction as Direction;
  const positionSize = Math.min(MAX_POSITION, portfolio.cash_balance);
  const entryTime = new Date().toISOString();

  // Trade in DB speichern (ZUERST — kein rückwirkend ändern erlaubt)
  const trade: Omit<DbPaperTrade, "id" | "created_at"> = {
    signal_id: signal.id,
    asset: signal.asset,
    direction,
    entry_price: entryPrice,
    exit_price: null,
    position_size: positionSize,
    entry_time: entryTime,
    exit_time: null,
    pnl_absolute: null,
    pnl_percent: null,
    status: "open",
  };

  const { error: tradeError } = await supabase.from("paper_trades").insert(trade);
  if (tradeError) throw new Error(`Trade-Insert fehlgeschlagen: ${tradeError.message}`);

  // Kapital reservieren
  await updateCashBalance(portfolio.cash_balance - positionSize);

  // Signal als gehandelt markieren
  await supabase.from("signals").update({ status: "traded" }).eq("id", signal.id);

  console.log(`[Executor] Trade eröffnet: ${signal.asset} ${direction} @ ${entryPrice} (${positionSize}€)`);
  return { success: true, entry_price: entryPrice };
}

async function checkPortfolioRiskGates(signal: DbSignal, cashBalance: number): Promise<{
  allowed: boolean;
  reason: string;
  openTrades: DbPaperTrade[];
}> {
  const { data: openTrades, error: openError } = await supabase
    .from("paper_trades")
    .select("*")
    .eq("status", "open");

  if (openError) return { allowed: false, reason: `Risk-Gate Fehler: ${openError.message}`, openTrades: [] };

  const typedOpenTrades = (openTrades || []) as DbPaperTrade[];
  const openCount = typedOpenTrades.length;
  if (openCount >= MAX_OPEN_POSITIONS) {
    return { allowed: false, reason: `Max offene Positionen erreicht (${openCount}/${MAX_OPEN_POSITIONS})`, openTrades: typedOpenTrades };
  }

  const openExposure = typedOpenTrades.reduce((sum, trade) => sum + Number(trade.position_size || 0), 0);
  const equity = cashBalance + openExposure;
  const projectedExposurePercent = equity > 0 ? ((openExposure + MAX_POSITION) / equity) * 100 : 100;
  if (projectedExposurePercent > MAX_EXPOSURE_PERCENT) {
    return { allowed: false, reason: `Max Exposure überschritten (${projectedExposurePercent.toFixed(1)}% > ${MAX_EXPOSURE_PERCENT}%)`, openTrades: typedOpenTrades };
  }

  const dailyLoss = await getTodayRealizedPnl();
  if (equity > 0 && dailyLoss < 0 && Math.abs(dailyLoss) >= equity * (MAX_DAILY_LOSS_PERCENT / 100)) {
    return { allowed: false, reason: `Daily Loss Limit erreicht (${dailyLoss.toFixed(2)}€)`, openTrades: typedOpenTrades };
  }

  const losingStreak = await getConsecutiveLosses();
  if (losingStreak >= MAX_CONSECUTIVE_LOSSES) {
    return { allowed: false, reason: `Loss-Streak Cooldown (${losingStreak}/${MAX_CONSECUTIVE_LOSSES})`, openTrades: typedOpenTrades };
  }

  if (signal.reasoning.startsWith("[Political Disclosure]") && signal.kronos_score < POLITICAL_CONFIRMATION_MIN_KRONOS) {
    return {
      allowed: false,
      reason: `Political Signal ohne Kronos-Bestätigung (${signal.kronos_score} < ${POLITICAL_CONFIRMATION_MIN_KRONOS})`,
      openTrades: typedOpenTrades,
    };
  }

  return { allowed: true, reason: "ok", openTrades: typedOpenTrades };
}

async function getTodayRealizedPnl(): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("paper_trades")
    .select("pnl_absolute")
    .eq("status", "closed")
    .gte("exit_time", todayStart.toISOString());

  if (error || !data) return 0;
  return data.reduce((sum, trade) => sum + Number(trade.pnl_absolute || 0), 0);
}

async function getConsecutiveLosses(): Promise<number> {
  const { data, error } = await supabase
    .from("paper_trades")
    .select("pnl_absolute")
    .eq("status", "closed")
    .order("exit_time", { ascending: false })
    .limit(MAX_CONSECUTIVE_LOSSES);

  if (error || !data) return 0;
  let losses = 0;
  for (const trade of data) {
    if (Number(trade.pnl_absolute || 0) < 0) losses++;
    else break;
  }
  return losses;
}

async function markSignalSkipped(signalId: string, reason: string): Promise<void> {
  await supabase
    .from("signals")
    .update({ status: "skipped", reasoning: reason })
    .eq("id", signalId);
}
