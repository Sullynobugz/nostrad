import { Router } from "express";
import { supabase } from "../services/supabase";
import { runEventEngine } from "../engines/eventEngine";
import { runSentimentEngine } from "../engines/sentimentEngine";
import { runPolymarketEngine } from "../engines/polymarketEngine";
import { runKronosEngine } from "../engines/kronosEngine";
import { runFinalSignalEngine } from "../engines/finalSignalEngine";
import { searchReddit } from "../services/reddit";
import { executeSignalIds } from "../paperTrading/executor";
import { closeTradeNow } from "../paperTrading/closer";
import { markTradeToMarket } from "../paperTrading/portfolio";
import { buildAdaptiveRiskPlan, getAdaptiveRiskConfig, getAdaptiveRiskExitReason } from "../paperTrading/riskEngine";
import type { DbEvent, DbPaperTrade, Direction } from "../types";

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
  const minFinalScore = parseInt((req.body?.min_final_score ?? process.env.PAPER_TRADING_MIN_FINAL_SCORE) || "65");
  const minEntryScore = Math.max(minConfidence, minFinalScore);
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

  for (const asset of watchlist) {
    try {
      const kronos = await runKronosEngine(asset);
      const signalConfidence = kronos.kronos_score;

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
          continue;
        }
      }

      if (kronos.kronos_direction === "neutral") {
        results.push({ asset, status: "skipped", reason: `Kronos neutral (score=${kronos.kronos_score})`, score: kronos.kronos_score, confidence: signalConfidence });
        continue;
      }

      if (signalConfidence < minEntryScore) {
        results.push({ asset, status: "skipped", reason: `Kronos score ${signalConfidence} < entry ${minEntryScore}`, score: kronos.kronos_score, confidence: signalConfidence });
        continue;
      }

      // Kein Duplikat wenn bereits offener Trade für dieses Asset
      if (existing) {
        results.push({ asset, status: "skipped", reason: "offene Position weiterhin valide", score: kronos.kronos_score, confidence: signalConfidence });
        continue;
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

  const tradeExecution = autoTrade && createdSignalIds.length > 0
    ? await executeSignalIds(createdSignalIds)
    : null;

  res.json({
    success: true,
    scanned: watchlist.length,
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
  });
});

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
