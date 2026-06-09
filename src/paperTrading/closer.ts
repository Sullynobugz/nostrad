import { supabase } from "../services/supabase";
import { getQuote } from "../services/finnhub";
import { updateCashBalance, getPortfolioState, takeSnapshot } from "./portfolio";
import type { DbPaperTrade } from "../types";

const HOLD_HOURS = parseInt(process.env.PAPER_TRADING_HOLD_HOURS || "24");
const CRYPTO_ASSETS = new Set(["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX"]);

// Schließt alle Trades die älter als HOLD_HOURS Stunden sind
export async function closeExpiredTrades(): Promise<{
  closed: number;
  errors: number;
  pnl_total: number;
  details: string[];
}> {
  const cutoffTime = new Date(Date.now() - HOLD_HOURS * 60 * 60 * 1000).toISOString();

  const { data: trades, error } = await supabase
    .from("paper_trades")
    .select("*")
    .eq("status", "open")
    .lt("entry_time", cutoffTime);

  if (error) throw new Error(`Trade-Fetch fehlgeschlagen: ${error.message}`);
  if (!trades || trades.length === 0) {
    return { closed: 0, errors: 0, pnl_total: 0, details: ["Keine abgelaufenen Trades"] };
  }

  let closed = 0;
  let errors = 0;
  let pnlTotal = 0;
  const details: string[] = [];

  for (const trade of trades as DbPaperTrade[]) {
    try {
      const result = await closeSingleTrade(trade);
      closed++;
      pnlTotal += result.pnl_absolute;
      const sign = result.pnl_absolute >= 0 ? "+" : "";
      details.push(
        `✓ Geschlossen: ${trade.asset} ${trade.direction} | PnL: ${sign}${result.pnl_absolute.toFixed(2)}€ (${sign}${result.pnl_percent.toFixed(2)}%)`
      );
    } catch (err) {
      errors++;
      details.push(`✗ Fehler beim Schließen von ${trade.asset}: ${(err as Error).message}`);
    }
  }

  // Portfolio-Snapshot nach dem Schließen
  await takeSnapshot();

  return { closed, errors, pnl_total: pnlTotal, details };
}

async function closeSingleTrade(trade: DbPaperTrade): Promise<{
  pnl_absolute: number;
  pnl_percent: number;
}> {
  // Aktuellen Exit-Preis holen
  let exitPrice: number;
  try {
    exitPrice = CRYPTO_ASSETS.has(trade.asset)
      ? await getQuote(`BINANCE:${trade.asset}USDT`)
      : await getQuote(trade.asset);
  } catch {
    try {
      exitPrice = CRYPTO_ASSETS.has(trade.asset)
        ? await getQuote(trade.asset)
        : await getQuote(`BINANCE:${trade.asset}USDT`);
    } catch (err) {
      throw new Error(`Exit-Preis nicht verfügbar: ${(err as Error).message}`);
    }
  }

  const exitTime = new Date().toISOString();

  // PnL berechnen
  // Bei Long: Gewinn wenn Preis gestiegen; Bei Short: Gewinn wenn Preis gefallen
  const priceChange =
    trade.direction === "long"
      ? (exitPrice - trade.entry_price) / trade.entry_price
      : (trade.entry_price - exitPrice) / trade.entry_price;

  const pnlAbsolute = Math.round(trade.position_size * priceChange * 100) / 100;
  const pnlPercent = Math.round(priceChange * 10000) / 100;

  // Trade in DB abschließen
  const { error } = await supabase
    .from("paper_trades")
    .update({
      exit_price: exitPrice,
      exit_time: exitTime,
      pnl_absolute: pnlAbsolute,
      pnl_percent: pnlPercent,
      status: "closed",
    })
    .eq("id", trade.id);

  if (error) throw new Error(`Trade-Close fehlgeschlagen: ${error.message}`);

  // Kapital zurückführen (Position + PnL)
  const portfolio = await getPortfolioState();
  await updateCashBalance(portfolio.cash_balance + trade.position_size + pnlAbsolute);

  console.log(
    `[Closer] Trade geschlossen: ${trade.asset} ${trade.direction} ` +
    `${trade.entry_price} → ${exitPrice} | PnL: ${pnlAbsolute > 0 ? "+" : ""}${pnlAbsolute}€`
  );

  return { pnl_absolute: pnlAbsolute, pnl_percent: pnlPercent };
}
