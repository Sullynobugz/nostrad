import axios from "axios";
import type { OHLCV } from "../types";

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const TWELVE_BASE = "https://api.twelvedata.com";
const ALPHA_BASE = "https://www.alphavantage.co/query";
const CRYPTO_ASSETS = new Set(["BTC", "ETH", "BNB", "SOL", "XRP", "ADA"]);

function parseNumeric(value: unknown): number | null {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function tokenizeSymbol(symbol: string) {
  const clean = symbol.replace(/^BINANCE:/i, "").replace(/USDT$/i, "").toUpperCase();
  return {
    clean,
    isCrypto: CRYPTO_ASSETS.has(clean),
    yahoo: CRYPTO_ASSETS.has(clean) ? `${clean}-USD` : clean,
    twelve: CRYPTO_ASSETS.has(clean) ? `${clean}/USD` : clean,
    alpha: CRYPTO_ASSETS.has(clean) ? { symbol: clean, market: "USD" as const } : { symbol: clean },
  };
}

function sortCandles(candles: OHLCV[]): OHLCV[] {
  return candles.sort((a, b) => a.date.localeCompare(b.date));
}

function candlesFromSeries(series: Array<Record<string, any>>): OHLCV[] {
  return sortCandles(
    series
      .map((row) => {
        const date = row.datetime || row.date || row.timestamp || row.time;
        const open = parseNumeric(row.open ?? row["1. open"] ?? row["1a. open (USD)"]);
        const high = parseNumeric(row.high ?? row["2. high"] ?? row["2a. high (USD)"]);
        const low = parseNumeric(row.low ?? row["3. low"] ?? row["3a. low (USD)"]);
        const close = parseNumeric(row.close ?? row["4. close"] ?? row["4a. close (USD)"]);
        const volume = parseNumeric(row.volume ?? row["5. volume"] ?? row["5. volume (USD)"]) ?? 0;

        if (!date || open === null || high === null || low === null || close === null) return null;
        return {
          date: String(date).split(" ")[0].split("T")[0],
          open,
          high,
          low,
          close,
          volume,
        };
      })
      .filter(Boolean) as OHLCV[]
  );
}

function fallbackError(symbol: string, errors: string[]): Error {
  return new Error(`Keine Marktdaten für ${symbol}: ${errors.join(" | ")}`);
}

function token(): string {
  if (!process.env.FINNHUB_API_KEY) throw new Error("FINNHUB_API_KEY fehlt");
  return process.env.FINNHUB_API_KEY;
}

function twelveToken(): string {
  if (!process.env.TWELVEDATA_API_KEY) throw new Error("TWELVEDATA_API_KEY fehlt");
  return process.env.TWELVEDATA_API_KEY;
}

function alphaToken(): string {
  if (!process.env.ALPHAVANTAGE_API_KEY) throw new Error("ALPHAVANTAGE_API_KEY fehlt");
  return process.env.ALPHAVANTAGE_API_KEY;
}

async function fetchFinnhubQuote(symbol: string): Promise<number> {
  const { data } = await axios.get(`${FINNHUB_BASE}/quote`, {
    params: { symbol, token: token() },
  });
  const price = parseNumeric(data?.c);
  if (price === null || price === 0) throw new Error(`Kein Preis für ${symbol}`);
  return price;
}

async function fetchTwelveQuote(symbol: string): Promise<number> {
  const t = twelveToken();
  const { data } = await axios.get(`${TWELVE_BASE}/quote`, {
    params: { symbol: tokenizeSymbol(symbol).twelve, apikey: t },
  });
  const price = parseNumeric(data?.close ?? data?.price ?? data?.last ?? data?.close_price);
  if (price === null || price === 0) throw new Error(`Twelve Data liefert keinen Preis für ${symbol}`);
  return price;
}

async function fetchAlphaQuote(symbol: string): Promise<number> {
  const { symbol: clean, market } = tokenizeSymbol(symbol).alpha;
  const params: Record<string, string> = { apikey: alphaToken() };

  if (market) {
    params.function = "CURRENCY_EXCHANGE_RATE";
    params.from_currency = clean;
    params.to_currency = market;
  } else {
    params.function = "GLOBAL_QUOTE";
    params.symbol = clean;
  }

  const { data } = await axios.get(ALPHA_BASE, { params });

  const price = market
    ? parseNumeric(data?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"])
    : parseNumeric(data?.["Global Quote"]?.["05. price"]);

  if (price === null || price === 0) throw new Error(`Alpha Vantage liefert keinen Preis für ${symbol}`);
  return price;
}

async function fetchYahooQuote(symbol: string): Promise<number> {
  const querySymbol = encodeURIComponent(tokenizeSymbol(symbol).yahoo);
  const { data } = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${querySymbol}`, {
    params: { range: "5d", interval: "1d", includePrePost: "false", events: "div,splits" },
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  const result = data?.chart?.result?.[0];
  const price =
    parseNumeric(result?.meta?.regularMarketPrice) ??
    parseNumeric(result?.meta?.previousClose) ??
    parseNumeric(result?.indicators?.quote?.[0]?.close?.slice?.(-1)?.[0]);

  if (price === null || price === 0) throw new Error(`Yahoo liefert keinen Preis für ${symbol}`);
  return price;
}

async function fetchFinnhubCandles(symbol: string, days: number): Promise<OHLCV[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 24 * 60 * 60;
  const endpoint = tokenizeSymbol(symbol).isCrypto ? `${FINNHUB_BASE}/crypto/candle` : `${FINNHUB_BASE}/stock/candle`;
  const params = tokenizeSymbol(symbol).isCrypto
    ? { symbol, resolution: "D", from, to, token: token() }
    : { symbol, resolution: "D", from, to, token: token() };

  const { data } = await axios.get(endpoint, { params });

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

async function fetchTwelveCandles(symbol: string, days: number): Promise<OHLCV[]> {
  const { data } = await axios.get(`${TWELVE_BASE}/time_series`, {
    params: {
      symbol: tokenizeSymbol(symbol).twelve,
      interval: "1day",
      outputsize: days + 5,
      apikey: twelveToken(),
    },
  });

  const series = Array.isArray(data?.values) ? data.values : null;
  if (!series?.length) {
    throw new Error(`Twelve Data liefert keine Candle-Daten für ${symbol}`);
  }

  return candlesFromSeries(series).slice(-days);
}

async function fetchAlphaCandles(symbol: string, days: number): Promise<OHLCV[]> {
  const asset = tokenizeSymbol(symbol).alpha;
  const params: Record<string, string> = { apikey: alphaToken() };

  if (asset.market) {
    params.function = "DIGITAL_CURRENCY_DAILY";
    params.symbol = asset.symbol;
    params.market = asset.market;
  } else {
    params.function = "TIME_SERIES_DAILY_ADJUSTED";
    params.symbol = asset.symbol;
    params.outputsize = "compact";
  }

  const { data } = await axios.get(ALPHA_BASE, { params });
  const key = asset.market ? "Time Series (Digital Currency Daily)" : "Time Series (Daily)";
  const series = data?.[key];
  if (!series) throw new Error(`Alpha Vantage liefert keine Candle-Daten für ${symbol}`);

  return candlesFromSeries(
    Object.entries(series).map(([date, row]) => ({ date, ...(row as Record<string, any>) }))
  ).slice(-days);
}

async function fetchYahooCandles(symbol: string, days: number): Promise<OHLCV[]> {
  const querySymbol = encodeURIComponent(tokenizeSymbol(symbol).yahoo);
  const { data } = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${querySymbol}`, {
    params: { range: `${Math.max(days, 7)}d`, interval: "1d", includePrePost: "false", events: "div,splits" },
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  const result = data?.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0];
  if (!timestamps.length || !quote) throw new Error(`Yahoo liefert keine Candle-Daten für ${symbol}`);

  return sortCandles(
    timestamps
      .map((timestamp, i) => ({
        date: new Date(timestamp * 1000).toISOString().split("T")[0],
        open: Number(quote.open?.[i]),
        high: Number(quote.high?.[i]),
        low: Number(quote.low?.[i]),
        close: Number(quote.close?.[i]),
        volume: Number(quote.volume?.[i] || 0),
      }))
      .filter((c) => Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))
      .slice(-days)
  );
}

async function withFallback<T>(attempts: Array<() => Promise<T>>, symbol: string): Promise<T> {
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  throw fallbackError(symbol, errors);
}

// Aktueller Preis eines Symbols
export async function getQuote(symbol: string): Promise<number> {
  return withFallback(
    [
      () => fetchFinnhubQuote(symbol),
      () => fetchTwelveQuote(symbol),
      () => fetchAlphaQuote(symbol),
      () => fetchYahooQuote(symbol),
    ],
    symbol
  );
}

// OHLCV-Candlestick-Daten (Tageskerzen, letzten n Tage)
export async function getCandles(symbol: string, days = 30): Promise<OHLCV[]> {
  return withFallback(
    [
      () => fetchFinnhubCandles(symbol, days),
      () => fetchTwelveCandles(symbol, days),
      () => fetchAlphaCandles(symbol, days),
      () => fetchYahooCandles(symbol, days),
    ],
    symbol
  );
}

// Crypto-Quote (z.B. BTC, ETH über Finnhub Crypto)
export async function getCryptoCandles(symbol: string, days = 30): Promise<OHLCV[]> {
  return withFallback(
    [
      () => fetchFinnhubCandles(symbol, days),
      () => fetchTwelveCandles(symbol, days),
      () => fetchAlphaCandles(symbol, days),
      () => fetchYahooCandles(symbol, days),
    ],
    symbol
  );
}

// Finanznews von Finnhub (ergänzend zu RSS)
export async function getMarketNews(category = "general", count = 10): Promise<Array<{
  headline: string;
  summary: string;
  url: string;
  source: string;
}>> {
  const { data } = await axios.get(`${FINNHUB_BASE}/news`, {
    params: { category, token: token() },
  });

  return (data as any[]).slice(0, count).map((item) => ({
    headline: item.headline,
    summary: item.summary,
    url: item.url,
    source: item.source,
  }));
}

export function generateMockCandles(days = 30, basePrice = 100): OHLCV[] {
  const today = new Date();
  const data: OHLCV[] = [];
  let price = basePrice;

  for (let i = days; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];

    const change = (Math.random() - 0.48) * price * 0.03;
    const open = price;
    const close = Math.max(price + change, price * 0.9);
    const high = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low = Math.min(open, close) * (1 - Math.random() * 0.01);
    price = close;

    data.push({
      date: dateStr,
      open,
      high,
      low,
      close,
      volume: Math.round(1000000 + Math.random() * 100000),
    });
  }

  return data;
}
