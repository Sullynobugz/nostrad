import { supabase } from "../services/supabase";
import type { DbPaperTrade, DbPortfolioState, PortfolioSummary } from "../types";

const START_BALANCE = parseFloat(process.env.PAPER_TRADING_START_BALANCE || "1000");

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

export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  const state = await getPortfolioState();
  const openTrades = await getOpenTrades();

  const openPositionsValue = openTrades.reduce((sum, t) => sum + t.position_size, 0);
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

export async function takeSnapshot(): Promise<void> {
  const { error } = await supabase.rpc("take_portfolio_snapshot");
  if (error) console.warn("Snapshot-Fehler:", error.message);
}
