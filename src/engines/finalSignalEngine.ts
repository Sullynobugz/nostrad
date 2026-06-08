import { callWithTool } from "../services/anthropic";
import { FINAL_SIGNAL_SYSTEM_PROMPT, buildFinalSignalUserPrompt } from "../prompts/finalSignalPrompt";
import type {
  EventEngineOutput,
  SentimentEngineOutput,
  PolymarketEngineOutput,
  KronosEngineOutput,
  FinalSignalOutput,
  Direction,
} from "../types";

interface FinalSignalEngineInput {
  asset: string;
  event: EventEngineOutput;
  sentiment: SentimentEngineOutput;
  polymarket: PolymarketEngineOutput | null;
  kronos: KronosEngineOutput;
  eventContext: string;
}

export async function runFinalSignalEngine(input: FinalSignalEngineInput): Promise<FinalSignalOutput> {
  // Polymarket-Score 0-100 aus der Wahrscheinlichkeit ableiten
  const polymarketScore = input.polymarket
    ? Math.round(Math.abs(input.polymarket.current_probability - 50) * 2)
    : 0;

  // Sentiment-Score normalisieren (-100..+100 → 0..100 für Vergleich)
  const sentimentNormalized = Math.round((input.sentiment.sentiment_score + 100) / 2);

  const llmResult = await callWithTool<{
    final_score: number;
    final_direction: Direction;
    confidence: number;
    reasoning: string;
    horizon: string;
  }>({
    systemPrompt: FINAL_SIGNAL_SYSTEM_PROMPT,
    userMessage: buildFinalSignalUserPrompt({
      asset: input.asset,
      eventScore: input.event.relevance_score,
      eventDirection: input.event.direction,
      eventConfidence: input.event.confidence,
      sentimentScore: input.sentiment.sentiment_score,
      sentimentConfidence: input.sentiment.confidence,
      polymarketScore,
      polymarketDirection: input.polymarket?.implied_direction || "neutral",
      polymarketConfidence: input.polymarket?.confidence || 0,
      kronosScore: input.kronos.kronos_score,
      kronosDirection: input.kronos.kronos_direction,
      kronosConfidence: input.kronos.confidence,
      eventContext: input.eventContext,
    }),
    toolName: "create_final_signal",
    toolDescription: "Erstellt das finale kombinierte Handelssignal aus allen vier Engines",
    inputSchema: {
      type: "object" as const,
      properties: {
        final_score: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Gewichteter Gesamt-Score (0 = kein Signal, 100 = maximales Signal)",
        },
        final_direction: {
          type: "string",
          enum: ["long", "short", "neutral"],
          description: "Finale Handelsrichtung",
        },
        confidence: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Gesamte Confidence inkl. Konsistenz-Bonus/Malus",
        },
        reasoning: {
          type: "string",
          description: "Begründung der finalen Entscheidung (2-3 Sätze)",
        },
        horizon: {
          type: "string",
          description: "Empfohlener Zeithorizont ('4h', '24h', '7d')",
        },
      },
      required: ["final_score", "final_direction", "confidence", "reasoning", "horizon"],
    },
  });

  return {
    asset: input.asset,
    horizon: llmResult.horizon,
    event_score: input.event.relevance_score,
    sentiment_score: input.sentiment.sentiment_score,
    polymarket_score: polymarketScore,
    kronos_score: input.kronos.kronos_score,
    final_score: llmResult.final_score,
    final_direction: llmResult.final_direction,
    confidence: llmResult.confidence,
    reasoning: llmResult.reasoning,
  };
}
