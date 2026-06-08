import { Router } from "express";
import { supabase } from "../services/supabase";
import { executePendingSignals } from "../paperTrading/executor";
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
