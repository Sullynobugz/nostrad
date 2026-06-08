import { supabase } from "../services/supabase";
import { getQuote } from "../services/finnhub";
import { getPortfolioState, updateCashBalance } from "./portfolio";
import type { DbSignal, DbPaperTrade, Direction } from "../types";

const MAX_POSITION = parseFloat(process.env.PAPER_TRADING_MAX_POSITION || "100");
const MIN_FINAL_SCORE = parseInt(process.env.PAPER_TRADING_MIN_FINAL_SCORE || "65");
const MIN_CONFIDENCE = parseInt(process.env.PAPER_TRADING_MIN_CONFIDENCE || "65");

// Prüft pending Signale und öffnet Trades wenn Kriterien erfüllt
export async function executePendingSignals(): Promise<{
  executed: number;
  skipped: number;
  details: string[];
}> {
  const { data: signals, error } = await supabase
    .from("signals")
    .select("*")
    .eq("status", "pending")
    .gte("final_score", MIN_FINAL_SCORE)
    .gte("confidence", MIN_CONFIDENCE)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Signals-Fetch fehlgeschlagen: ${error.message}`);
  if (!signals || signals.length === 0) {
    return { executed: 0, skipped: 0, details: ["Keine handelbaren Signale"] };
  }

  let executed = 0;
  let skipped = 0;
  const details: string[] = [];

  for (const signal of signals as DbSignal[]) {
    try {
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
    entryPrice = await getQuote(signal.asset);
  } catch {
    // Bei Crypto-Assets alternatives Format versuchen
    try {
      entryPrice = await getQuote(`BINANCE:${signal.asset}USDT`);
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

async function markSignalSkipped(signalId: string, reason: string): Promise<void> {
  await supabase
    .from("signals")
    .update({ status: "skipped", reasoning: reason })
    .eq("id", signalId);
}
