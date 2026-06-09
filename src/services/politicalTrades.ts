import axios from "axios";

export interface PoliticalTrade {
  politician: string;
  chamber?: string | null;
  party?: string | null;
  asset: string;
  transaction_type: "purchase" | "sale" | "other";
  transaction_date: string;
  disclosure_date: string;
  amount_min: number;
  amount_max: number;
  source_url?: string | null;
}

interface RawQuiverTrade {
  Representative?: string;
  Senator?: string;
  Politician?: string;
  Chamber?: string;
  Party?: string;
  Ticker?: string;
  TickerSymbol?: string;
  Transaction?: string;
  TransactionDate?: string;
  ReportDate?: string;
  DisclosureDate?: string;
  Range?: string;
  Amount?: string;
  Source?: string;
  URL?: string;
}

export async function fetchPoliticalTrades(limit = 50): Promise<PoliticalTrade[]> {
  const provider = (process.env.POLITICAL_TRADES_PROVIDER || "quiver").toLowerCase();
  if (provider !== "quiver") {
    throw new Error(`POLITICAL_TRADES_PROVIDER ${provider} wird noch nicht unterstützt`);
  }

  const apiKey = process.env.QUIVER_API_KEY;
  if (!apiKey) {
    throw new Error("QUIVER_API_KEY fehlt. Politische Trade-Signale sind ohne Datenprovider deaktiviert.");
  }

  const baseUrl = process.env.QUIVER_API_BASE_URL || "https://api.quiverquant.com/beta";
  const endpoints = (process.env.QUIVER_CONGRESS_ENDPOINTS || "/live/congresstrading,/bulk/congresstrading,/bulk/congress/trading")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const errors: string[] = [];

  for (const endpoint of endpoints) {
    try {
      const { data } = await axios.get(`${baseUrl}${endpoint}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 30000,
      });
      const rows = Array.isArray(data) ? data : data?.data;
      if (!Array.isArray(rows)) throw new Error("Antwort ist kein Array");
      return rows.slice(0, limit).map(normalizeQuiverTrade).filter(Boolean) as PoliticalTrade[];
    } catch (err) {
      errors.push(`${endpoint}: ${(err as Error).message}`);
    }
  }

  const historical = await fetchHistoricalCongressTrades(baseUrl, apiKey, limit, errors);
  if (historical.length > 0) return historical;

  throw new Error(`Quiver Congress-Trades konnten nicht geladen werden: ${errors.join(" | ")}`);
}

function normalizeQuiverTrade(raw: RawQuiverTrade): PoliticalTrade | null {
  const ticker = (raw.Ticker || raw.TickerSymbol || "").replace("$", "").trim().toUpperCase();
  const tx = normalizeTransaction(raw.Transaction || "");
  const transactionDate = raw.TransactionDate || "";
  const disclosureDate = raw.ReportDate || raw.DisclosureDate || transactionDate;
  if (!ticker || !tx || !transactionDate || !disclosureDate) return null;

  const amount = parseAmountRange(raw.Range || raw.Amount || "");
  return {
    politician: raw.Politician || raw.Representative || raw.Senator || "Unknown",
    chamber: raw.Chamber || null,
    party: raw.Party || null,
    asset: ticker,
    transaction_type: tx,
    transaction_date: transactionDate,
    disclosure_date: disclosureDate,
    amount_min: amount.min,
    amount_max: amount.max,
    source_url: raw.Source || raw.URL || null,
  };
}

function normalizeTransaction(value: string): PoliticalTrade["transaction_type"] | null {
  const normalized = value.toLowerCase();
  if (normalized.includes("purchase") || normalized.includes("buy")) return "purchase";
  if (normalized.includes("sale") || normalized.includes("sell")) return "sale";
  if (normalized.includes("exchange")) return "other";
  return null;
}

function parseAmountRange(value: string): { min: number; max: number } {
  const numbers = value
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .split(/[^0-9]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (numbers.length === 0) return { min: 1000, max: 15000 };
  if (numbers.length === 1) return { min: numbers[0], max: numbers[0] };
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

async function fetchHistoricalCongressTrades(
  baseUrl: string,
  apiKey: string,
  limit: number,
  errors: string[]
): Promise<PoliticalTrade[]> {
  const tickers = (process.env.POLITICAL_TRADES_WATCHLIST || process.env.KRONOS_WATCHLIST || "NVDA,AAPL,MSFT,TSLA,AMZN,GOOGL,META")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 25);

  const trades: PoliticalTrade[] = [];

  for (const ticker of tickers) {
    if (trades.length >= limit) break;
    const endpoint = `/historical/congresstrading/${ticker}`;
    try {
      const { data } = await axios.get(`${baseUrl}${endpoint}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 30000,
      });
      const rows = Array.isArray(data) ? data : data?.data;
      if (!Array.isArray(rows)) throw new Error("Antwort ist kein Array");
      trades.push(...(rows.map(normalizeQuiverTrade).filter(Boolean) as PoliticalTrade[]));
    } catch (err) {
      errors.push(`${endpoint}: ${(err as Error).message}`);
    }
  }

  return trades
    .sort((a, b) => new Date(b.disclosure_date).getTime() - new Date(a.disclosure_date).getTime())
    .slice(0, limit);
}
