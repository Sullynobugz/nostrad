import { supabase } from "../services/supabase";
import { getQuote } from "../services/finnhub";
import type { DbPaperTrade, DbPortfolioState, OpenPaperTrade, PortfolioSummary } from "../types";

const START_BALANCE = parseFloat(process.env.PAPER_TRADING_START_BALANCE || "1000");
const CRYPTO_ASSETS = new Set(["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX"]);

export async function getPortfolioState(): Promise<DbPortfolioState> {
  const { data, error } = await supabase
    .from("portfolio_state")
    .select("*")
    .eq("id", 1)
    .single();

  if (error || !data) throw new Error(`Portfolio-State nicht gefunden: ${error?.message}`);
  return data;
}

export async function updateCashBalance(newBalance: number): Promise<void> {
  const { error } = await supabase
    .from("portfolio_state")
    .update({ cash_balance: newBalance, updated_at: new Date().toISOString() })
    .eq("id", 1);

  if (error) throw new Error(`Portfolio-Update fehlgeschlagen: ${error.message}`);
}

export async function getOpenTrades(): Promise<DbPaperTrade[]> {
  const { data, error } = await supabase
    .from("paper_trades")
    .select("*")
    .eq("status", "open")
    .order("entry_time", { ascending: false });

  if (error) throw new Error(`Fehler beim Laden offener Trades: ${error.message}`);
  return data || [];
}

export async function getOpenTradesMarked(): Promise<OpenPaperTrade[]> {
  const trades = await getOpenTrades();
  return Promise.all(trades.map(markTradeToMarket));
}

export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  const state = await getPortfolioState();
  const openTrades = await getOpenTradesMarked();

  const openPositionsValue = openTrades.reduce((sum, t) => sum + (t.current_value ?? t.position_size), 0);
  const totalEquity = state.cash_balance + openPositionsValue;
  const totalPnl = totalEquity - START_BALANCE;
  const totalPnlPercent = (totalPnl / START_BALANCE) * 100;

  const { count: closedCount } = await supabase
    .from("paper_trades")
    .select("*", { count: "exact", head: true })
    .eq("status", "closed");

  return {
    cash_balance: state.cash_balance,
    open_positions: openTrades,
    open_positions_value: openPositionsValue,
    total_equity: totalEquity,
    total_pnl: totalPnl,
    total_pnl_percent: totalPnlPercent,
    trade_count_open: openTrades.length,
    trade_count_closed: closedCount || 0,
  };
}

async function markTradeToMarket(trade: DbPaperTrade): Promise<OpenPaperTrade> {
  const hoursOpen = (Date.now() - new Date(trade.entry_time).getTime()) / 3600000;

  try {
    const currentPrice = await getTradeQuote(trade.asset);
    const priceChange =
      trade.direction === "long"
        ? (currentPrice - trade.entry_price) / trade.entry_price
        : (trade.entry_price - currentPrice) / trade.entry_price;
    const pnlAbsolute = Math.round(trade.position_size * priceChange * 100) / 100;
    const pnlPercent = Math.round(priceChange * 10000) / 100;

    return {
      ...trade,
      current_price: currentPrice,
      current_value: Math.round((trade.position_size + pnlAbsolute) * 100) / 100,
      unrealized_pnl_absolute: pnlAbsolute,
      unrealized_pnl_percent: pnlPercent,
      hours_open: hoursOpen,
      price_error: null,
    };
  } catch (err) {
    return {
      ...trade,
      current_price: null,
      current_value: trade.position_size,
      unrealized_pnl_absolute: null,
      unrealized_pnl_percent: null,
      hours_open: hoursOpen,
      price_error: (err as Error).message,
    };
  }
}

async function getTradeQuote(asset: string): Promise<number> {
  const normalized = asset.toUpperCase();
  try {
    return CRYPTO_ASSETS.has(normalized)
      ? await getQuote(`BINANCE:${normalized}USDT`)
      : await getQuote(normalized);
  } catch {
    return CRYPTO_ASSETS.has(normalized)
      ? await getQuote(normalized)
      : await getQuote(`BINANCE:${normalized}USDT`);
  }
}

export async function takeSnapshot(): Promise<void> {
  const { error } = await supabase.rpc("take_portfolio_snapshot");
  if (error) console.warn("Snapshot-Fehler:", error.message);
}
