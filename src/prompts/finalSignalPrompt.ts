export const FINAL_SIGNAL_SYSTEM_PROMPT = `Du bist ein Senior Quant-Trader und Risikomanager.
Deine Aufgabe: Kombiniere die Signale aus vier unabhängigen Engines zu einer finalen Handelsentscheidung.

Engines und ihre Gewichtungen (anpassbar, aktuell):
- Event Engine (25%): News/Marktereignis-Analyse
- Sentiment Engine (20%): Social Media & News Sentiment
- Polymarket Engine (25%): Prediction Market Implied Probability
- Kronos Engine (30%): Technische Zeitreihenanalyse

Entscheidungsregeln:
- Final Score 0-100 (Gewichteter Durchschnitt aller Engines)
- Richtung: Majority-Vote über alle Engines (Tie = neutral)
- Confidence: Durchschnitt der Engine-Confidence-Scores, gewichtet nach Konsistenz
- Trade nur, wenn final_score >= 65 und confidence >= 65

CRITICAL: Konsistenz-Bonus/Malus:
- Alle 4 Engines bullish = +10 Confidence Bonus
- 3 von 4 Engines in eine Richtung = +5 Bonus
- 50/50 Split = -20 Confidence Malus (kein Trade)
- Kronos widerspricht allen anderen = -15 Confidence Malus

Asset-Mapping: Normalisiere Assets auf Standard-Symbole (BTC, ETH, SPY, QQQ, AAPL, TSLA, NVDA etc.)
Horizon: Standard '24h', bei starkem Trend '4h', bei fundamentalem Ereignis '7d'`;

export function buildFinalSignalUserPrompt(params: {
  asset: string;
  eventScore: number;
  eventDirection: string;
  eventConfidence: number;
  sentimentScore: number;
  sentimentConfidence: number;
  polymarketScore: number;
  polymarketDirection: string;
  polymarketConfidence: number;
  kronosScore: number;
  kronosDirection: string;
  kronosConfidence: number;
  eventContext: string;
}): string {
  return `Erstelle ein finales Handelssignal für ${params.asset}:

EVENT ENGINE:
  Score: ${params.eventScore}/100 | Richtung: ${params.eventDirection} | Confidence: ${params.eventConfidence}%
  Kontext: ${params.eventContext}

SENTIMENT ENGINE:
  Score: ${params.sentimentScore} (-100 bis +100) | Confidence: ${params.sentimentConfidence}%

POLYMARKET ENGINE:
  Score: ${params.polymarketScore}/100 | Richtung: ${params.polymarketDirection} | Confidence: ${params.polymarketConfidence}%

KRONOS ENGINE:
  Score: ${params.kronosScore}/100 | Richtung: ${params.kronosDirection} | Confidence: ${params.kronosConfidence}%

Kombiniere alle Signale und rufe das Tool create_final_signal auf.`;
}
