import { getFinanceMarkets } from "../services/polymarket";
import type { PolymarketEngineOutput, PolymarketMarket } from "../types";

// Berechnet einen Polymarket-Score basierend auf Marktwahrscheinlichkeiten
export async function runPolymarketEngine(asset?: string): Promise<PolymarketEngineOutput> {
  const markets = await getFinanceMarkets();

  if (markets.length === 0) {
    return {
      market_title: "Keine Polymarket-Daten",
      current_probability: 50,
      probability_change: 0,
      implied_direction: "neutral",
      confidence: 10,
      relevant_markets: [],
    };
  }

  // Asset-spezifische Märkte filtern wenn angegeben
  let relevantMarkets = markets;
  if (asset) {
    const assetLower = asset.toLowerCase();
    const filtered = markets.filter((m) =>
      m.title.toLowerCase().includes(assetLower) ||
      m.title.toLowerCase().includes(assetToKeyword(assetLower))
    );
    if (filtered.length > 0) relevantMarkets = filtered;
  }

  // Signifikante Märkte: hohe oder niedrige Wahrscheinlichkeit
  const significant = relevantMarkets.filter(
    (m) => m.probability > 65 || m.probability < 35
  );

  const topMarkets = significant.slice(0, 5);
  const avgProbability = topMarkets.length > 0
    ? topMarkets.reduce((sum, m) => sum + m.probability, 0) / topMarkets.length
    : 50;

  const direction = avgProbability > 55
    ? "bullish"
    : avgProbability < 45
    ? "bearish"
    : "neutral";

  // Score: Distanz zur 50% Linie × 2 (0-100)
  const polymarketScore = Math.round(Math.abs(avgProbability - 50) * 2);

  // Confidence: Anzahl relevanter Märkte als Proxy
  const confidence = Math.min(40 + topMarkets.length * 10, 85);

  const topMarket = topMarkets[0] || relevantMarkets[0];

  return {
    market_title: topMarket?.title || "Allgemeine Finanzmärkte",
    current_probability: Math.round(avgProbability),
    probability_change: 0, // Wird in zukünftiger Version mit historischen Daten berechnet
    implied_direction: direction,
    confidence,
    relevant_markets: topMarkets,
  };
}

function assetToKeyword(asset: string): string {
  const map: Record<string, string> = {
    btc: "bitcoin",
    eth: "ethereum",
    spy: "s&p",
    qqq: "nasdaq",
    nvda: "nvidia",
    tsla: "tesla",
    aapl: "apple",
    msft: "microsoft",
    googl: "google",
    amzn: "amazon",
  };
  return map[asset] || asset;
}

// Liefert den polymarket_score als Zahl 0-100
export function polymarketOutputToScore(output: PolymarketEngineOutput): number {
  return Math.round(Math.abs(output.current_probability - 50) * 2);
}
