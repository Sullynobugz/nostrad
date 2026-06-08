import axios from "axios";
import type { PolymarketMarket } from "../types";

const CLOB_BASE = "https://clob.polymarket.com";
const GAMMA_BASE = "https://gamma-api.polymarket.com";

interface RawMarket {
  condition_id: string;
  question_id: string;
  tokens: Array<{ token_id: string; outcome: string }>;
  question: string;
  description?: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
}

interface RawMarketWithPrice extends RawMarket {
  outcomePrices?: string;  // JSON-encoded array
}

// Aktive Märkte von Polymarket holen
export async function getActiveMarkets(limit = 50): Promise<PolymarketMarket[]> {
  try {
    // Gamma API gibt einfachere Datenstruktur
    const { data } = await axios.get(`${GAMMA_BASE}/markets`, {
      params: {
        active: true,
        closed: false,
        limit,
        order: "volume24hr",
        ascending: false,
      },
      timeout: 10000,
    });

    const markets: PolymarketMarket[] = [];

    for (const market of (data as any[])) {
      try {
        const prices: number[] = JSON.parse(market.outcomePrices || "[]");
        const yesProbability = prices.length > 0 ? Math.round(prices[0] * 100) : 50;

        markets.push({
          id: market.id || market.conditionId,
          title: market.question,
          probability: yesProbability,
          change_24h: 0, // Berechnen wir separat wenn nötig
        });
      } catch {
        // Einzelne Märkte überspringen bei Parse-Fehler
      }
    }

    return markets;
  } catch (err) {
    console.error("Polymarket API Fehler:", err);
    return [];
  }
}

// Märkte nach Keyword filtern (z.B. "bitcoin", "fed", "election")
export async function searchMarkets(keyword: string): Promise<PolymarketMarket[]> {
  const markets = await getActiveMarkets(200);
  const lc = keyword.toLowerCase();
  return markets.filter((m) => m.title.toLowerCase().includes(lc));
}

// Auffällige Märkte: hohe Wahrscheinlichkeit (>70%) oder starke Veränderung
export async function getSignificantMarkets(): Promise<PolymarketMarket[]> {
  const markets = await getActiveMarkets(100);
  return markets.filter((m) => m.probability > 70 || m.probability < 30);
}

// Finanz-/Makro-relevante Märkte filtern
const FINANCE_KEYWORDS = [
  "fed", "interest rate", "bitcoin", "btc", "ethereum", "eth",
  "inflation", "gdp", "recession", "stock", "crypto", "nasdaq",
  "s&p", "oil", "gold", "dollar", "eur", "election", "trump",
  "china", "tariff", "bank", "earnings", "ipo",
];

export async function getFinanceMarkets(): Promise<PolymarketMarket[]> {
  const markets = await getActiveMarkets(200);
  return markets.filter((m) =>
    FINANCE_KEYWORDS.some((kw) => m.title.toLowerCase().includes(kw))
  );
}
