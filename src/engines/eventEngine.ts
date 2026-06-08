import { callWithTool } from "../services/anthropic";
import { EVENT_SYSTEM_PROMPT, buildEventUserPrompt } from "../prompts/eventPrompt";
import type { EventEngineInput, EventEngineOutput } from "../types";

export async function runEventEngine(input: EventEngineInput): Promise<EventEngineOutput> {
  return callWithTool<EventEngineOutput>({
    systemPrompt: EVENT_SYSTEM_PROMPT,
    userMessage: buildEventUserPrompt(input.title, input.summary, input.source),
    toolName: "classify_event",
    toolDescription: "Klassifiziert ein Finanz-Event nach Marktrelevanz, betroffenen Assets, Richtung und Confidence",
    inputSchema: {
      type: "object" as const,
      properties: {
        relevance_score: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Marktrelevanz des Events (0 = irrelevant, 100 = market-moving)",
        },
        affected_assets: {
          type: "array",
          items: { type: "string" },
          description: "Betroffene Asset-Ticker (z.B. ['BTC', 'ETH', 'SPY'])",
        },
        direction: {
          type: "string",
          enum: ["bullish", "bearish", "neutral"],
          description: "Preisrichtung die das Event impliziert",
        },
        confidence: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Confidence in die Bewertung",
        },
        reasoning: {
          type: "string",
          description: "Kurze Begründung (max 2 Sätze)",
        },
      },
      required: ["relevance_score", "affected_assets", "direction", "confidence", "reasoning"],
    },
  });
}
