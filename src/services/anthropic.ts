import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Hilfsfunktion: Tool-Use-Call
// Erzwingt JSON-Output über tool_choice: "any"
export async function callWithTool<T>(params: {
  systemPrompt: string;
  userMessage: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Anthropic.Tool["input_schema"];
  model?: string;
  signal?: AbortSignal;
}): Promise<T> {
  const {
    systemPrompt,
    userMessage,
    toolName,
    toolDescription,
    inputSchema,
    model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    signal,
  } = params;

  const response = await anthropic.messages.create(
    {
      model,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          name: toolName,
          description: toolDescription,
          input_schema: inputSchema,
        },
      ],
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: userMessage }],
    },
    { signal, maxRetries: 0 }
  );

  const toolBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );

  if (!toolBlock) {
    throw new Error(`Kein Tool-Use-Block in Antwort von ${toolName}`);
  }

  return toolBlock.input as T;
}
