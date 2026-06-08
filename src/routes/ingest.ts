import { Router } from "express";
import { supabase } from "../services/supabase";
import { fetchAllFeeds } from "../services/rss";
import { fetchFinanceReddit } from "../services/reddit";
import { getFinanceMarkets } from "../services/polymarket";
import { getMarketNews, getCandles, getCryptoCandles } from "../services/finnhub";
import { runEventEngine } from "../engines/eventEngine";
import { runSentimentEngine } from "../engines/sentimentEngine";
import type { RawNewsItem, RawRedditPost } from "../types";

const CRYPTO_ASSETS = new Set(["BTC", "ETH", "BNB", "SOL", "XRP", "ADA"]);


export const ingestRouter = Router();

// POST /api/ingest/run — Vollständiger Ingestion-Zyklus
ingestRouter.post("/run", async (req, res) => {
  try {
    const [rssItems, redditPosts, finnhubNews] = await Promise.allSettled([
      fetchAllFeeds(),
      fetchFinanceReddit(),
      getMarketNews("general", 20),
    ]);

    const allNewsItems: RawNewsItem[] = [
      ...(rssItems.status === "fulfilled" ? rssItems.value : []),
      ...(finnhubNews.status === "fulfilled"
        ? finnhubNews.value.map((n) => ({ title: n.headline, summary: n.summary, url: n.url, source: n.source }))
        : []),
    ];

    const allRedditPosts: RawRedditPost[] =
      redditPosts.status === "fulfilled" ? redditPosts.value : [];

    let inserted = 0;
    let duplicates = 0;
    const errors: string[] = [];

    // News-Items verarbeiten
    for (const item of allNewsItems.slice(0, 30)) {
      if (!item.title || !item.url) continue;
      try {
        const engineOutput = await runEventEngine({
          title: item.title,
          summary: item.summary,
          source: item.source,
          url: item.url,
        });

        // Nur relevante Events speichern (Score > 20)
        if (engineOutput.relevance_score <= 20) {
          duplicates++;
          continue;
        }

        const { data: existingEvent, error: existingError } = await supabase
          .from("events")
          .select("id")
          .eq("url", item.url)
          .maybeSingle();

        if (existingError) {
          errors.push(`${item.title}: ${existingError.message}`);
          continue;
        }

        if (existingEvent) {
          duplicates++;
          continue;
        }

        const { error } = await supabase.from("events").insert({
          source: item.source,
          url: item.url,
          title: item.title,
          summary: item.summary,
          relevance_score: engineOutput.relevance_score,
          sentiment_score: 0,
          affected_assets: engineOutput.affected_assets,
          processed: false,
        });

        if (error?.code === "23505") duplicates++;
        else if (error) errors.push(`${item.title}: ${error.message}`);
        else inserted++;
      } catch (err) {
        errors.push(`Engine-Fehler für "${item.title}": ${(err as Error).message}`);
      }
    }

    // Reddit-Posts aggregieren und als Sentiment speichern
    if (allRedditPosts.length > 0) {
      try {
        const sentimentOutput = await runSentimentEngine({
          items: allRedditPosts.slice(0, 20).map((p) => ({
            text: `${p.title} ${p.selftext}`.slice(0, 300),
            source: `Reddit r/${p.subreddit}`,
          })),
        });

        // Reddit-Batch als ein Event speichern
        const { error } = await supabase.from("events").insert({
          source: "reddit_batch",
          url: null,
          title: `Reddit Sentiment Batch — ${new Date().toISOString().split("T")[0]}`,
          summary: `${allRedditPosts.length} Reddit-Posts analysiert. Score: ${sentimentOutput.sentiment_score}`,
          relevance_score: 30,
          sentiment_score: sentimentOutput.sentiment_score,
          affected_assets: [],
          processed: false,
        });
        if (!error) inserted++;
      } catch (err) {
        errors.push(`Reddit-Sentiment-Fehler: ${(err as Error).message}`);
      }
    }

    res.json({
      success: true,
      inserted,
      duplicates,
      errors,
      sources: {
        rss: rssItems.status === "fulfilled" ? rssItems.value.length : 0,
        reddit: allRedditPosts.length,
        finnhub: finnhubNews.status === "fulfilled" ? finnhubNews.value.length : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/ingest/event — Einzelnes Event manuell einpflegen
ingestRouter.post("/event", async (req, res) => {
  const { title, summary, source, url } = req.body;
  if (!title || !summary || !source) {
    return res.status(400).json({ error: "title, summary, source erforderlich" });
  }

  try {
    const engineOutput = await runEventEngine({ title, summary, source, url });

    const { data, error } = await supabase
      .from("events")
      .insert({
        source,
        url: url || null,
        title,
        summary,
        relevance_score: engineOutput.relevance_score,
        sentiment_score: 0,
        affected_assets: engineOutput.affected_assets,
        processed: false,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, event: data, analysis: engineOutput });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/ingest/candles?asset=BTC — OHLCV-Daten für Chart
ingestRouter.get("/candles", async (req, res) => {
  const asset = (req.query.asset as string || "BTC").toUpperCase();
  try {
    const candles = CRYPTO_ASSETS.has(asset)
      ? await getCryptoCandles(`BINANCE:${asset}USDT`, 60)
      : await getCandles(asset, 60);
    res.json(candles);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
