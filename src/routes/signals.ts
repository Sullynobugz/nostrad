import { Router } from "express";
import { supabase } from "../services/supabase";
import { runEventEngine } from "../engines/eventEngine";
import { runSentimentEngine } from "../engines/sentimentEngine";
import { runPolymarketEngine } from "../engines/polymarketEngine";
import { runKronosEngine } from "../engines/kronosEngine";
import { runFinalSignalEngine } from "../engines/finalSignalEngine";
import { runPreScreen } from "../engines/preScreenEngine";
import { searchReddit } from "../services/reddit";
import { executeSignalIds } from "../paperTrading/executor";
import { closeTradeNow } from "../paperTrading/closer";
import { markTradeToMarket } from "../paperTrading/portfolio";
import { buildAdaptiveRiskPlan, getAdaptiveRiskConfig, getAdaptiveRiskExitReason } from "../paperTrading/riskEngine";
import { beginRun, finishRun, getRunState, isRunStopRequested, requestRunStop } from "../services/runControl";
import type { DbEvent, DbPaperTrade, Direction } from "../types";

export const signalsRouter = Router();

signalsRouter.get("/kronos-scan/status", (_req, res) => {
  res.json(getRunState());
});

signalsRouter.post("/kronos-scan/stop", (_req, res) => {
  const state = requestRunStop("kronos_scan");
  res.json({
    success: Boolean(state),
    stopped: Boolean(state?.stopRequested),
    state: state ?? getRunState(),
  });
});

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
  const run = beginRun("kronos_scan", "Kronos Scan");
  if (!run) {
    return res.status(409).json({
      success: false,
      error: "Ein Kronos Scan läuft bereits",
      run: getRunState(),
    });
  }
  const activeRun = run;

  try {
  const envWatchlist = process.env.KRONOS_WATCHLIST?.split(",").map((s) => s.trim()).filter(Boolean);
  const defaultWatchlist = [
    "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX",
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "COIN", "MSTR",
    "SPY", "QQQ", "IWM", "DIA", "GLD", "SLV", "USO", "TLT",
  ];
  const watchlist: string[] = req.body?.assets ?? envWatchlist ?? defaultWatchlist;
  const minConfidence = parseInt((req.body?.min_confidence ?? process.env.PAPER_TRADING_MIN_CONFIDENCE) || "65");
  const minFinalScore = parseInt((req.body?.min_final_score ?? process.env.PAPER_TRADING_MIN_FINAL_SCORE) || "65");
  const minEntryScore = Math.max(minConfidence, minFinalScore);
  const concurrency = Math.max(1, Math.min(6, parseInt((req.body?.concurrency ?? process.env.KRONOS_SCAN_CONCURRENCY) || "3")));
  const preScreenEnabled = String(req.body?.prescreen_enabled ?? process.env.KRONOS_PRESCREEN_ENABLED ?? "false") === "true";
  const preScreenTopN = Math.max(1, Math.min(watchlist.length, parseInt((req.body?.prescreen_top_n ?? process.env.KRONOS_PRESCREEN_TOP_N) || "8")));
  const preScreenMinScore = parseInt((req.body?.prescreen_min_score ?? process.env.KRONOS_PRESCREEN_MIN_SCORE) || "45");
  const exitScore = parseInt((req.body?.exit_score ?? process.env.PAPER_TRADING_EXIT_SCORE) || "55");
  const takeProfitPercent = parseFloat((req.body?.take_profit_percent ?? process.env.PAPER_TRADING_TAKE_PROFIT_PERCENT) || "3");
  const stopLossPercent = parseFloat((req.body?.stop_loss_percent ?? process.env.PAPER_TRADING_STOP_LOSS_PERCENT) || "2");
  const riskConfig = getAdaptiveRiskConfig({
    fallbackTakeProfitPercent: takeProfitPercent,
    fallbackStopLossPercent: stopLossPercent,
  });
  const autoTrade = req.body?.auto_trade !== false;
  const autoClose = req.body?.auto_close !== false;
  const createdSignalIds: string[] = [];
  const closedTrades: string[] = [];

  const results: Array<{
    asset: string;
    status: "signal_created" | "trade_closed" | "skipped" | "error";
    reason?: string;
    direction?: string;
    score?: number;
    confidence?: number;
    signal_id?: string;
    trade_id?: string;
    pnl_absolute?: number;
    pnl_percent?: number;
    error?: string;
  }> = [];

  const { data: openForReview } = await supabase
    .from("paper_trades")
    .select("asset")
    .eq("status", "open");
  const openAssets = new Set((openForReview || []).map((trade) => String(trade.asset).toUpperCase()));

  let assetsToReview = watchlist;
  let preScreenResults: Awaited<ReturnType<typeof runPreScreen>>[] = [];

  if (preScreenEnabled) {
    preScreenResults = await Promise.all(watchlist.map((asset) => runPreScreen(asset)));
    const ranked = [...preScreenResults]
      .filter((result) => result.score >= preScreenMinScore || result.force_review || openAssets.has(result.asset))
      .sort((a, b) => Number(openAssets.has(b.asset)) - Number(openAssets.has(a.asset)) || b.score - a.score);
    assetsToReview = [...new Set(ranked.slice(0, preScreenTopN).map((result) => result.asset))];

    for (const result of preScreenResults) {
      if (!assetsToReview.includes(result.asset)) {
        results.push({
          asset: result.asset,
          status: "skipped",
          reason: `PreScreen filtered: ${result.reason}`,
          score: result.score,
          confidence: result.score,
        });
      }
    }
  }

  async function processAsset(asset: string): Promise<void> {
    if (isRunStopRequested(activeRun.id)) {
      results.push({ asset, status: "skipped", reason: "Scan gestoppt" });
      return;
    }

    try {
      const kronos = await runKronosEngine(asset);
      const signalConfidence = kronos.kronos_score;

      if (isRunStopRequested(activeRun.id)) {
        results.push({ asset, status: "skipped", reason: "Scan gestoppt" });
        return;
      }

      const { data: existing } = await supabase
        .from("paper_trades")
        .select("*")
        .eq("asset", asset)
        .eq("status", "open")
        .maybeSingle();

      const recommendedDirection: Direction =
        kronos.kronos_direction === "bullish"
          ? "long"
          : kronos.kronos_direction === "bearish"
          ? "short"
          : "neutral";

      if (existing && autoClose) {
        const markedTrade = await markTradeToMarket(existing as DbPaperTrade);
        const riskPlan = await buildAdaptiveRiskPlan(asset, riskConfig, existing as DbPaperTrade);
        const exitReason =
          getAdaptiveRiskExitReason(existing as DbPaperTrade, markedTrade, riskPlan) ??
          getKronosExitReason(existing as DbPaperTrade, recommendedDirection, signalConfidence, minConfidence, exitScore);
        if (exitReason) {
          const closed = await closeTradeNow(existing.id, exitReason);
          closedTrades.push(existing.id);
          results.push({
            asset,
            status: "trade_closed",
            trade_id: existing.id,
            direction: existing.direction,
            score: kronos.kronos_score,
            confidence: signalConfidence,
            reason: exitReason,
            pnl_absolute: closed.pnl_absolute,
            pnl_percent: closed.pnl_percent,
          });
          return;
        }
      }

      if (kronos.kronos_direction === "neutral") {
        results.push({ asset, status: "skipped", reason: `Kronos neutral (score=${kronos.kronos_score})`, score: kronos.kronos_score, confidence: signalConfidence });
        return;
      }

      if (signalConfidence < minEntryScore) {
        results.push({ asset, status: "skipped", reason: `Kronos score ${signalConfidence} < entry ${minEntryScore}`, score: kronos.kronos_score, confidence: signalConfidence });
        return;
      }

      // Kein Duplikat wenn bereits offener Trade für dieses Asset
      if (existing) {
        results.push({ asset, status: "skipped", reason: "offene Position weiterhin valide", score: kronos.kronos_score, confidence: signalConfidence });
        return;
      }

      const direction: Direction = recommendedDirection;

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
          confidence: signalConfidence,
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
          confidence: signalConfidence,
        });
      }
    } catch (err) {
      results.push({ asset, status: "error", error: (err as Error).message });
    }
  }

  await runWithConcurrency(assetsToReview, concurrency, processAsset, () => isRunStopRequested(activeRun.id));

  const stopped = isRunStopRequested(activeRun.id);
  const tradeExecution = autoTrade && !stopped && createdSignalIds.length > 0
    ? await executeSignalIds(createdSignalIds)
    : null;

  const response = {
    success: true,
    stopped,
    scanned: watchlist.length,
    reviewed: assetsToReview.length,
    concurrency,
    prescreen_enabled: preScreenEnabled,
    prescreen_top_n: preScreenTopN,
    prescreen_min_score: preScreenMinScore,
    prescreen_results: preScreenResults,
    signals_created: results.filter((r) => r.status === "signal_created").length,
    trades_closed: closedTrades.length,
    auto_trade: autoTrade,
    auto_close: autoClose,
    take_profit_percent: takeProfitPercent,
    stop_loss_percent: stopLossPercent,
    min_entry_score: minEntryScore,
    adaptive_risk: {
      atr_period: riskConfig.atrPeriod,
      stop_atr_multiplier: riskConfig.stopAtrMultiplier,
      reward_risk_ratio: riskConfig.rewardRiskRatio,
      trailing_start_r: riskConfig.trailingStartR,
      trailing_atr_multiplier: riskConfig.trailingAtrMultiplier,
    },
    exit_score: exitScore,
    trades_executed: tradeExecution?.executed ?? 0,
    trades_skipped: tradeExecution?.skipped ?? 0,
    trade_details: tradeExecution?.details ?? [],
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  };

  finishRun(activeRun.id, stopped ? "stopped" : "done", stopped ? "Kronos Scan gestoppt" : "Kronos Scan fertig");
  res.json(response);
  } catch (err) {
    finishRun(activeRun.id, "error", (err as Error).message);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  shouldStop?: () => boolean
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      if (shouldStop?.()) return;
      const item = items[nextIndex++];
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function getKronosExitReason(
  trade: DbPaperTrade,
  recommendedDirection: Direction,
  kronosScore: number,
  entryScore: number,
  exitScore: number
): string | null {
  if (recommendedDirection !== "neutral" && recommendedDirection !== trade.direction && kronosScore >= entryScore) {
    return `Kronos Gegensignal ${recommendedDirection} mit Score ${kronosScore}`;
  }

  if (recommendedDirection === "neutral" || kronosScore < exitScore) {
    return `Kronos Setup nicht mehr stark genug (Score ${kronosScore} < Exit ${exitScore})`;
  }

  return null;
}

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
