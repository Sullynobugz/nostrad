import { Router } from "express";
import { supabase } from "../services/supabase";
import { runEventEngine } from "../engines/eventEngine";
import { runSentimentEngine } from "../engines/sentimentEngine";
import { runPolymarketEngine } from "../engines/polymarketEngine";
import { runKronosEngine } from "../engines/kronosEngine";
import { runFinalSignalEngine } from "../engines/finalSignalEngine";
import { searchReddit } from "../services/reddit";
import { executeSignalIds } from "../paperTrading/executor";
import type { DbEvent, Direction } from "../types";

export const signalsRouter = Router();

// POST /api/signals/generate — Signal für ein Event generieren
signalsRouter.post("/generate", async (req, res) => {
  const { event_id, asset } = req.body;

  if (!event_id && !asset) {
    return res.status(400).json({ error: "event_id oder asset erforderlich" });
  }

  try {
    let event: DbEvent | null = null;

    if (event_id) {
      const { data } = await supabase.from("events").select("*").eq("id", event_id).single();
      event = data;
    }

    // Asset aus Event oder Request
    const targetAsset = asset || event?.affected_assets?.[0];
    if (!targetAsset) {
      return res.status(400).json({ error: "Kein Asset ermittelbar — bitte asset übergeben" });
    }

    // Alle vier Engines parallel starten
    const [eventResult, sentimentResult, polymarketResult, kronosResult] = await Promise.allSettled([
      event
        ? runEventEngine({ title: event.title, summary: event.summary, source: event.source })
        : Promise.resolve({ relevance_score: 50, affected_assets: [targetAsset], direction: "neutral" as const, confidence: 50, reasoning: "Kein Event verknüpft" }),
      fetchRecentSentiment(targetAsset),
      runPolymarketEngine(targetAsset),
      runKronosEngine(targetAsset),
    ]);

    const eventOutput = eventResult.status === "fulfilled" ? eventResult.value : { relevance_score: 0, affected_assets: [], direction: "neutral" as const, confidence: 0, reasoning: "Engine-Fehler" };
    const sentimentOutput = sentimentResult.status === "fulfilled" ? sentimentResult.value : { sentiment_score: 0, confidence: 0, sources: [], reasoning: "Engine-Fehler" };
    const polymarketOutput = polymarketResult.status === "fulfilled" ? polymarketResult.value : null;
    const kronosOutput = kronosResult.status === "fulfilled" ? kronosResult.value : { kronos_direction: "neutral" as const, kronos_score: 0, confidence: 0, horizon: "24h", reasoning: "Engine-Fehler", mode: "mock" as const };

    // Final Signal
    const finalSignal = await runFinalSignalEngine({
      asset: targetAsset,
      event: eventOutput,
      sentiment: sentimentOutput,
      polymarket: polymarketOutput,
      kronos: kronosOutput,
      eventContext: event?.title || targetAsset,
    });

    // In Supabase speichern
    const { data: savedSignal, error } = await supabase
      .from("signals")
      .insert({
        event_id: event_id || null,
        asset: finalSignal.asset,
        horizon: finalSignal.horizon,
        event_score: finalSignal.event_score,
        sentiment_score: finalSignal.sentiment_score,
        polymarket_score: finalSignal.polymarket_score,
        kronos_score: finalSignal.kronos_score,
        final_score: finalSignal.final_score,
        final_direction: finalSignal.final_direction,
        confidence: finalSignal.confidence,
        reasoning: finalSignal.reasoning,
        status: "pending",
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Event als verarbeitet markieren
    if (event_id) {
      await supabase.from("events").update({ processed: true }).eq("id", event_id);
    }

    res.json({
      success: true,
      signal: savedSignal,
      engine_details: {
        event: eventOutput,
        sentiment: sentimentOutput,
        polymarket: polymarketOutput,
        kronos: kronosOutput,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/signals/process-queue — Alle unverarbeiteten Events abarbeiten
signalsRouter.post("/process-queue", async (req, res) => {
  const { data: unprocessed, error } = await supabase
    .from("events")
    .select("*")
    .eq("processed", false)
    .gte("relevance_score", 40)
    .order("relevance_score", { ascending: false })
    .limit(10);

  if (error) return res.status(500).json({ error: error.message });
  if (!unprocessed || unprocessed.length === 0) {
    return res.json({ success: true, processed: 0, message: "Keine Events in der Queue" });
  }

  const results = [];
  for (const event of unprocessed as DbEvent[]) {
    const asset = event.affected_assets?.[0];
    if (!asset) continue;

    try {
      const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/signals/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: event.id, asset }),
      });
      const data = await response.json() as any;
      results.push({ event_id: event.id, asset, success: true, signal_id: data.signal?.id });
    } catch (err) {
      results.push({ event_id: event.id, asset, success: false, error: (err as Error).message });
    }
  }

  res.json({ success: true, processed: results.filter((r) => r.success).length, results });
});

// POST /api/signals/kronos-scan — Watchlist mit Kronos scannen, Signale direkt erstellen
// Kein News-Ingest nötig. Kronos IS der Signal.
signalsRouter.post("/kronos-scan", async (req, res) => {
  const envWatchlist = process.env.KRONOS_WATCHLIST?.split(",").map((s) => s.trim()).filter(Boolean);
  const defaultWatchlist = [
    "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX",
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "COIN", "MSTR",
    "SPY", "QQQ", "IWM", "DIA", "GLD", "SLV", "USO", "TLT",
  ];
  const watchlist: string[] = req.body?.assets ?? envWatchlist ?? defaultWatchlist;
  const minConfidence = parseInt((req.body?.min_confidence ?? process.env.PAPER_TRADING_MIN_CONFIDENCE) || "65");
  const autoTrade = req.body?.auto_trade !== false;
  const createdSignalIds: string[] = [];

  const results: Array<{
    asset: string;
    status: "signal_created" | "skipped" | "error";
    reason?: string;
    direction?: string;
    score?: number;
    confidence?: number;
    signal_id?: string;
    error?: string;
  }> = [];

  for (const asset of watchlist) {
    try {
      const kronos = await runKronosEngine(asset);

      if (kronos.kronos_direction === "neutral") {
        results.push({ asset, status: "skipped", reason: `Kronos neutral (score=${kronos.kronos_score})` });
        continue;
      }

      if (kronos.confidence < minConfidence) {
        results.push({ asset, status: "skipped", reason: `Confidence ${kronos.confidence} < ${minConfidence}` });
        continue;
      }

      // Kein Duplikat wenn bereits offener Trade für dieses Asset
      const { data: existing } = await supabase
        .from("paper_trades")
        .select("id")
        .eq("asset", asset)
        .eq("status", "open")
        .maybeSingle();

      if (existing) {
        results.push({ asset, status: "skipped", reason: "offene Position vorhanden" });
        continue;
      }

      const direction: Direction =
        kronos.kronos_direction === "bullish" ? "long" : "short";

      const { data: signal, error } = await supabase
        .from("signals")
        .insert({
          event_id: null,
          asset,
          horizon: kronos.horizon,
          event_score: 50,
          sentiment_score: 50,
          polymarket_score: 50,
          kronos_score: kronos.kronos_score,
          final_score: kronos.kronos_score,
          final_direction: direction,
          confidence: kronos.confidence,
          reasoning: `[Kronos-Scan · ${kronos.mode}] ${kronos.reasoning}`,
          status: "pending",
        })
        .select()
        .single();

      if (error) {
        results.push({ asset, status: "error", error: error.message });
      } else {
        createdSignalIds.push(signal.id);
        results.push({
          asset,
          status: "signal_created",
          signal_id: signal.id,
          direction,
          score: kronos.kronos_score,
          confidence: kronos.confidence,
        });
      }
    } catch (err) {
      results.push({ asset, status: "error", error: (err as Error).message });
    }
  }

  const tradeExecution = autoTrade && createdSignalIds.length > 0
    ? await executeSignalIds(createdSignalIds)
    : null;

  res.json({
    success: true,
    scanned: watchlist.length,
    signals_created: results.filter((r) => r.status === "signal_created").length,
    auto_trade: autoTrade,
    trades_executed: tradeExecution?.executed ?? 0,
    trades_skipped: tradeExecution?.skipped ?? 0,
    trade_details: tradeExecution?.details ?? [],
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  });
});

// GET /api/signals/latest — Letzte Signale
signalsRouter.get("/latest", async (req, res) => {
  const limit = parseInt(req.query.limit as string || "20");
  const { data, error } = await supabase
    .from("signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Hilfsfunktion: Neuestes Reddit-Sentiment für ein Asset holen
async function fetchRecentSentiment(asset: string) {
  const posts = await searchReddit(asset);
  return runSentimentEngine({
    items: posts.slice(0, 15).map((p) => ({
      text: `${p.title} ${p.selftext}`.slice(0, 300),
      source: `Reddit r/${p.subreddit}`,
    })),
    asset,
  });
}
