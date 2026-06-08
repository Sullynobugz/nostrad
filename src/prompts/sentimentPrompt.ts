export const SENTIMENT_SYSTEM_PROMPT = `Du bist ein Experte für Markt-Sentiment-Analyse, spezialisiert auf Social Media und News-Flows.
Deine Aufgabe: Aggregiere mehrere Texte (Reddit-Posts, News-Headlines) zu einem einzigen Sentiment-Score.

Bewertungskriterien:
- Sentiment Score (-100 bis +100): Negativ = bearish/Angst, Positiv = bullish/Gier, 0 = neutral
  - -100 bis -70: Extremes Fear (Crash-Stimmung, Panik)
  - -70 bis -40: Bearish (allgemeine Skepsis)
  - -40 bis -10: Leicht bearish
  - -10 bis +10: Neutral
  - +10 bis +40: Leicht bullish
  - +40 bis +70: Bullish (Optimismus)
  - +70 bis +100: Extremes Greed (Euphorie, FOMO)
- Confidence (0-100): Wie konsistent ist das Sentiment über alle Quellen?
- Sources: Welche Quellen haben das Sentiment am stärksten beeinflusst?
- Reasoning: 1-2 Sätze Begründung

Wichtig:
- WSB-Posts sind oft übertrieben — discount by 30%
- Suche nach genuinen Signalen, nicht Surface-Level-Emotionen
- Große Score-Spreads zwischen Quellen = niedrigere Confidence`;

export function buildSentimentUserPrompt(
  items: Array<{ text: string; source: string }>,
  asset?: string
): string {
  const itemsText = items
    .slice(0, 20)
    .map((item, i) => `[${i + 1}] (${item.source}): ${item.text}`)
    .join("\n\n");

  return `Analysiere das Markt-Sentiment für${asset ? ` Asset: ${asset}` : " allgemeine Märkte"}.

Folgende Texte wurden gesammelt:

${itemsText}

Erstelle einen aggregierten Sentiment-Score und rufe das Tool analyze_sentiment auf.`;
}
