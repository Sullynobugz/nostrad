import Parser from "rss-parser";
import type { RawNewsItem } from "../types";

const parser = new Parser({ timeout: 8000 });

const RSS_FEEDS: Array<{ url: string; source: string }> = [
  // Yahoo Finance
  { url: "https://finance.yahoo.com/rss/topfinstories", source: "Yahoo Finance" },
  { url: "https://finance.yahoo.com/rss/2.0/headline?s=BTC-USD&region=US&lang=en-US", source: "Yahoo Bitcoin" },
  // Reuters
  { url: "https://feeds.reuters.com/reuters/businessNews", source: "Reuters Business" },
  { url: "https://feeds.reuters.com/reuters/technologyNews", source: "Reuters Tech" },
  // Seeking Alpha (kostenlose Feeds)
  { url: "https://seekingalpha.com/market_currents.xml", source: "Seeking Alpha" },
  // MarketWatch
  { url: "https://feeds.marketwatch.com/marketwatch/marketpulse/", source: "MarketWatch" },
  // FT (kostenlose Headlines)
  { url: "https://www.ft.com/rss/home/uk", source: "Financial Times" },
  // CoinDesk (Crypto)
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", source: "CoinDesk" },
  // The Block
  { url: "https://www.theblock.co/rss.xml", source: "The Block" },
];

async function fetchFeed(url: string, source: string): Promise<RawNewsItem[]> {
  try {
    const feed = await parser.parseURL(url);
    return feed.items.slice(0, 20).map((item) => ({
      title: item.title || "",
      summary: (item.contentSnippet || item.summary || item.content || "").slice(0, 800),
      url: item.link || item.guid || "",
      source,
      published_at: item.pubDate || item.isoDate,
    }));
  } catch (err) {
    console.warn(`RSS ${source} nicht erreichbar:`, (err as Error).message);
    return [];
  }
}

// Alle konfigurierten Feeds parallel abrufen
export async function fetchAllFeeds(): Promise<RawNewsItem[]> {
  const results = await Promise.allSettled(
    RSS_FEEDS.map((feed) => fetchFeed(feed.url, feed.source))
  );

  const items = results
    .filter((r): r is PromiseFulfilledResult<RawNewsItem[]> => r.status === "fulfilled")
    .flatMap((r) => r.value)
    .filter((item) => item.title && item.url);

  // Deduplizieren per URL
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

// Einzelnen Feed abrufen
export async function fetchSingleFeed(url: string, source: string): Promise<RawNewsItem[]> {
  return fetchFeed(url, source);
}
