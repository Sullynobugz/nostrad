import { Router } from "express";
import { supabase } from "../services/supabase";
import { executePendingSignals, executeDemoSignals } from "../paperTrading/executor";
import { closeExpiredTrades } from "../paperTrading/closer";
import { getPortfolioSummary, takeSnapshot } from "../paperTrading/portfolio";

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
  const { data, error } = await supabase
    .from("open_trades_with_signal")
    .select("*");

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
