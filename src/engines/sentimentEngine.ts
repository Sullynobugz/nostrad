import { callWithTool } from "../services/anthropic";
import { SENTIMENT_SYSTEM_PROMPT, buildSentimentUserPrompt } from "../prompts/sentimentPrompt";
import type { SentimentInput, SentimentEngineOutput } from "../types";

export async function runSentimentEngine(input: SentimentInput): Promise<SentimentEngineOutput> {
  if (input.items.length === 0) {
    return {
      sentiment_score: 0,
      confidence: 10,
      sources: [],
      reasoning: "Keine Sentiment-Daten verfügbar",
    };
  }

  return callWithTool<SentimentEngineOutput>({
    systemPrompt: SENTIMENT_SYSTEM_PROMPT,
    userMessage: buildSentimentUserPrompt(input.items, input.asset),
    toolName: "analyze_sentiment",
    toolDescription: "Aggregiert Markt-Sentiment aus mehreren Quellen zu einem Score",
    inputSchema: {
      type: "object" as const,
      properties: {
        sentiment_score: {
          type: "integer",
          minimum: -100,
          maximum: 100,
          description: "Aggregierter Sentiment-Score (-100 = extrem bearish, +100 = extrem bullish)",
        },
        confidence: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Confidence in den Score (höher wenn Quellen konsistent)",
        },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "Quellen die das Sentiment am stärksten beeinflusst haben",
        },
        reasoning: {
          type: "string",
          description: "Kurze Begründung des Sentiments (1-2 Sätze)",
        },
      },
      required: ["sentiment_score", "confidence", "sources", "reasoning"],
    },
  });
}
