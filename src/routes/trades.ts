import { Router } from "express";
import { supabase } from "../services/supabase";
import { executePendingSignals, executeDemoSignals } from "../paperTrading/executor";
import { closeExpiredTrades } from "../paperTrading/closer";
import { getOpenTradesMarked, getPortfolioSummary, takeSnapshot } from "../paperTrading/portfolio";

export const tradesRouter = Router();

// POST /api/trades/execute — Pending Signale ausführen
tradesRouter.post("/execute", async (req, res) => {
  try {
    const result = await executePendingSignals();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/trades/demo-execute — Demo-Trade-Run mit begrenzter Anzahl
tradesRouter.post("/demo-execute", async (req, res) => {
  try {
    const limit = Number.isFinite(Number(req.body?.limit)) ? Math.max(1, Math.min(5, Number(req.body.limit))) : 3;
    const result = await executeDemoSignals(limit);
    res.json({ success: true, demo: true, limit, ...result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/trades/close-expired — Abgelaufene Trades schließen
tradesRouter.post("/close-expired", async (req, res) => {
  try {
    const result = await closeExpiredTrades();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/trades/open — Offene Trades
tradesRouter.get("/open", async (req, res) => {
  try {
    const trades = await getOpenTradesMarked();
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/trades/history — Trade-Historie
tradesRouter.get("/history", async (req, res) => {
  const limit = parseInt(req.query.limit as string || "50");
  const { data, error } = await supabase
    .from("paper_trades")
    .select("*, signals(final_score, confidence, event_score, sentiment_score, polymarket_score, kronos_score, reasoning)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/trades/performance — Kennzahlen für Forward-Test
tradesRouter.get("/performance", async (req, res) => {
  const limit = parseInt(req.query.limit as string || "500");
  const { data, error } = await supabase
    .from("paper_trades")
    .select("*, signals(final_score, confidence, event_score, sentiment_score, polymarket_score, kronos_score, reasoning)")
    .eq("status", "closed")
    .order("exit_time", { ascending: true })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });

  const trades = data || [];
  const wins = trades.filter((t: any) => Number(t.pnl_absolute || 0) > 0);
  const losses = trades.filter((t: any) => Number(t.pnl_absolute || 0) < 0);
  const grossProfit = wins.reduce((sum: number, t: any) => sum + Number(t.pnl_absolute || 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum: number, t: any) => sum + Number(t.pnl_absolute || 0), 0));
  const totalPnl = trades.reduce((sum: number, t: any) => sum + Number(t.pnl_absolute || 0), 0);
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  res.json({
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: trades.length ? (wins.length / trades.length) * 100 : 0,
    total_pnl: totalPnl,
    expectancy: trades.length ? totalPnl / trades.length : 0,
    avg_win: avgWin,
    avg_loss: avgLoss,
    payoff_ratio: avgLoss ? avgWin / avgLoss : 0,
    profit_factor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0,
    max_drawdown: calculateMaxDrawdown(trades as any[]),
    by_asset: groupPerformance(trades as any[], (t) => t.asset),
    by_direction: groupPerformance(trades as any[], (t) => t.direction),
    by_score_bucket: groupPerformance(trades as any[], (t) => scoreBucket(t.signals?.final_score)),
    recent: trades.slice(-25).reverse(),
  });
});

// GET /api/trades/portfolio — Portfolio-Übersicht
tradesRouter.get("/portfolio", async (req, res) => {
  try {
    const summary = await getPortfolioSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/trades/snapshot — Manuell Portfolio-Snapshot
tradesRouter.post("/snapshot", async (req, res) => {
  try {
    await takeSnapshot();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/trades/reset — Alles löschen, Startkapital zurücksetzen
tradesRouter.post("/reset", async (req, res) => {
  const START_BALANCE = parseFloat(process.env.PAPER_TRADING_START_BALANCE || "1000");
  const steps: string[] = [];
  const errors: string[] = [];

  async function step(label: string, fn: () => Promise<void>) {
    try {
      await fn();
      steps.push(`✓ ${label}`);
    } catch (err) {
      errors.push(`✗ ${label}: ${(err as Error).message}`);
    }
  }

  const epoch = "2000-01-01T00:00:00.000Z";

  await step("paper_trades gelöscht", async () => {
    const { error } = await supabase.from("paper_trades").delete().gte("created_at", epoch);
    if (error) throw error;
  });

  await step("signals gelöscht", async () => {
    const { error } = await supabase.from("signals").delete().gte("created_at", epoch);
    if (error) throw error;
  });

  await step("events gelöscht", async () => {
    const { error } = await supabase.from("events").delete().gte("created_at", epoch);
    if (error) throw error;
  });

  await step("portfolio_snapshots gelöscht", async () => {
    const { error } = await supabase.from("portfolio_snapshots").delete().gte("created_at", epoch);
    if (error) throw error;
  });

  await step(`Startkapital auf ${START_BALANCE}€ zurückgesetzt`, async () => {
    const { error } = await supabase
      .from("portfolio_state")
      .update({ cash_balance: START_BALANCE, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw error;
  });

  res.json({
    success: errors.length === 0,
    start_balance: START_BALANCE,
    steps,
    errors,
  });
});

function calculateMaxDrawdown(trades: any[]): number {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    equity += Number(trade.pnl_absolute || 0);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }
  return maxDrawdown;
}

function groupPerformance(trades: any[], keyFn: (trade: any) => string): Array<{
  key: string;
  count: number;
  win_rate: number;
  pnl: number;
  expectancy: number;
}> {
  const groups = new Map<string, any[]>();
  for (const trade of trades) {
    const key = keyFn(trade) || "unknown";
    groups.set(key, [...(groups.get(key) || []), trade]);
  }

  return [...groups.entries()]
    .map(([key, rows]) => {
      const pnl = rows.reduce((sum, trade) => sum + Number(trade.pnl_absolute || 0), 0);
      const wins = rows.filter((trade) => Number(trade.pnl_absolute || 0) > 0).length;
      return {
        key,
        count: rows.length,
        win_rate: rows.length ? (wins / rows.length) * 100 : 0,
        pnl,
        expectancy: rows.length ? pnl / rows.length : 0,
      };
    })
    .sort((a, b) => b.pnl - a.pnl);
}

function scoreBucket(score: number | null | undefined): string {
  const value = Number(score || 0);
  if (value >= 80) return "80-100";
  if (value >= 70) return "70-79";
  if (value >= 60) return "60-69";
  if (value >= 50) return "50-59";
  return "0-49";
}
