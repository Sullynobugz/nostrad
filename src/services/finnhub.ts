import axios from "axios";
import type { OHLCV } from "../types";

const BASE = "https://finnhub.io/api/v1";

function token(): string {
  if (!process.env.FINNHUB_API_KEY) throw new Error("FINNHUB_API_KEY fehlt");
  return process.env.FINNHUB_API_KEY;
}

// Aktueller Preis eines Symbols
export async function getQuote(symbol: string): Promise<number> {
  const { data } = await axios.get(`${BASE}/quote`, {
    params: { symbol, token: token() },
  });
  if (!data.c || data.c === 0) throw new Error(`Kein Preis für ${symbol}`);
  return data.c;
}

// OHLCV-Candlestick-Daten (Tageskerzen, letzten n Tage)
export async function getCandles(symbol: string, days = 30): Promise<OHLCV[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 24 * 60 * 60;

  const { data } = await axios.get(`${BASE}/stock/candle`, {
    params: { symbol, resolution: "D", from, to, token: token() },
  });

  if (data.s !== "ok" || !data.t) {
    throw new Error(`Keine Candle-Daten für ${symbol}`);
  }

  return data.t.map((timestamp: number, i: number) => ({
    date: new Date(timestamp * 1000).toISOString().split("T")[0],
    open: data.o[i],
    high: data.h[i],
    low: data.l[i],
    close: data.c[i],
    volume: data.v[i],
  }));
}

// Crypto-Quote (z.B. BTC, ETH über Finnhub Crypto)
export async function getCryptoCandles(symbol: string, days = 30): Promise<OHLCV[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 24 * 60 * 60;

  const { data } = await axios.get(`${BASE}/crypto/candle`, {
    params: { symbol, resolution: "D", from, to, token: token() },
  });

  if (data.s !== "ok" || !data.t) {
    throw new Error(`Keine Crypto-Candle-Daten für ${symbol}`);
  }

  return data.t.map((timestamp: number, i: number) => ({
    date: new Date(timestamp * 1000).toISOString().split("T")[0],
    open: data.o[i],
    high: data.h[i],
    low: data.l[i],
    close: data.c[i],
    volume: data.v[i],
  }));
}

// Finanznews von Finnhub (ergänzend zu RSS)
export async function getMarketNews(category = "general", count = 10): Promise<Array<{
  headline: string;
  summary: string;
  url: string;
  source: string;
}>> {
  const { data } = await axios.get(`${BASE}/news`, {
    params: { category, token: token() },
  });

  return (data as any[]).slice(0, count).map((item) => ({
    headline: item.headline,
    summary: item.summary,
    url: item.url,
    source: item.source,
  }));
}
