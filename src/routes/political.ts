import { Router } from "express";
import { supabase } from "../services/supabase";
import { runKronosEngine } from "../engines/kronosEngine";
import { fetchPoliticalTrades, type PoliticalTrade } from "../services/politicalTrades";

export const politicalRouter = Router();

// POST /api/political/scan — erzeugt Paper-Trading-Signale aus politischen Disclosures.
politicalRouter.post("/scan", async (req, res) => {
  const limit = clampInt(req.body?.limit, 1, 200, 50);
  const maxDisclosureAgeDays = clampInt(
    req.body?.max_disclosure_age_days ?? process.env.POLITICAL_TRADES_MAX_DISCLOSURE_AGE_DAYS,
    1,
    120,
    30
  );
  const minAmount = clampInt(
    req.body?.min_amount ?? process.env.POLITICAL_TRADES_MIN_AMOUNT,
    1000,
    10000000,
    50000
  );
  const minScore = clampInt(
    req.body?.min_score ?? process.env.POLITICAL_TRADES_MIN_SCORE,
    1,
    100,
    70
  );
  const minKronosScore = clampInt(
    req.body?.min_kronos_score ?? process.env.POLITICAL_CONFIRMATION_MIN_KRONOS,
    1,
    100,
    65
  );

  try {
    const trades = await fetchPoliticalTrades(limit);
    const results = [];

    for (const trade of trades) {
      const score = scorePoliticalTrade(trade, { maxDisclosureAgeDays, minAmount });
      if (score.direction !== "long" || score.finalScore < minScore) {
        results.push({ asset: trade.asset, politician: trade.politician, status: "skipped", reason: score.reason, score: score.finalScore });
        continue;
      }

      const kronos = await runKronosEngine(trade.asset);
      if (kronos.kronos_direction !== "bullish" || kronos.kronos_score < minKronosScore) {
        results.push({
          asset: trade.asset,
          politician: trade.politician,
          status: "skipped",
          reason: `Kronos bestätigt Political-Kauf nicht (${kronos.kronos_direction}, score=${kronos.kronos_score})`,
          score: score.finalScore,
        });
        continue;
      }

      const sourceUrl = trade.source_url || `political:${trade.politician}:${trade.asset}:${trade.transaction_date}`;
      const { data: existing } = await supabase
        .from("signals")
        .select("id")
        .eq("asset", trade.asset)
        .eq("reasoning", score.reasoning)
        .maybeSingle();

      if (existing) {
        results.push({ asset: trade.asset, politician: trade.politician, status: "duplicate", signal_id: existing.id });
        continue;
      }

      const { data: signal, error } = await supabase
        .from("signals")
        .insert({
          event_id: null,
          asset: trade.asset,
          horizon: "7d",
          event_score: score.finalScore,
          sentiment_score: 50,
          polymarket_score: 50,
          kronos_score: kronos.kronos_score,
          final_score: Math.round(score.finalScore * 0.6 + kronos.kronos_score * 0.4),
          final_direction: score.direction,
          confidence: Math.round(score.finalScore * 0.6 + kronos.kronos_score * 0.4),
          reasoning: `${score.reasoning || sourceUrl} Kronos bestätigt bullish mit Score ${kronos.kronos_score}.`,
          status: "pending",
        })
        .select()
        .single();

      if (error) {
        results.push({ asset: trade.asset, politician: trade.politician, status: "error", error: error.message });
      } else {
        results.push({ asset: trade.asset, politician: trade.politician, status: "signal_created", signal_id: signal.id, score: score.finalScore });
      }
    }

    res.json({
      success: true,
      scanned: trades.length,
      signals_created: results.filter((r) => r.status === "signal_created").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      duplicates: results.filter((r) => r.status === "duplicate").length,
      results,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

function scorePoliticalTrade(
  trade: PoliticalTrade,
  config: { maxDisclosureAgeDays: number; minAmount: number }
): {
  direction: "long" | "short" | "neutral";
  finalScore: number;
  reason: string;
  reasoning: string;
} {
  const ageDays = daysSince(trade.disclosure_date);
  const amountMid = (trade.amount_min + trade.amount_max) / 2;

  if (trade.transaction_type !== "purchase") {
    return {
      direction: "neutral",
      finalScore: 0,
      reason: "Nur Käufe werden als Copy-Signal verwendet",
      reasoning: "",
    };
  }

  if (ageDays > config.maxDisclosureAgeDays) {
    return {
      direction: "neutral",
      finalScore: 0,
      reason: `Disclosure zu alt (${ageDays}d > ${config.maxDisclosureAgeDays}d)`,
      reasoning: "",
    };
  }

  if (amountMid < config.minAmount) {
    return {
      direction: "neutral",
      finalScore: 0,
      reason: `Trade zu klein (${Math.round(amountMid)} < ${config.minAmount})`,
      reasoning: "",
    };
  }

  const amountScore = Math.min(35, Math.log10(amountMid / config.minAmount + 1) * 22);
  const freshnessScore = Math.max(0, 25 * (1 - ageDays / config.maxDisclosureAgeDays));
  const rangePenalty = trade.amount_max > trade.amount_min ? Math.min(10, Math.log10(trade.amount_max / trade.amount_min) * 6) : 0;
  const finalScore = Math.round(Math.max(1, Math.min(100, 45 + amountScore + freshnessScore - rangePenalty)));

  return {
    direction: "long",
    finalScore,
    reason: "political_purchase_signal",
    reasoning:
      `[Political Disclosure] ${trade.politician} kaufte ${trade.asset} ` +
      `(${trade.amount_min}-${trade.amount_max}, transaction=${trade.transaction_date}, disclosure=${trade.disclosure_date}). ` +
      `Score basiert auf gemeldeter Größe und Frische; Disclosure ist verzögert, kein Beweis für Insiderwissen.`,
  };
}

function daysSince(dateString: string): number {
  const timestamp = new Date(dateString).getTime();
  if (!Number.isFinite(timestamp)) return 999;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
