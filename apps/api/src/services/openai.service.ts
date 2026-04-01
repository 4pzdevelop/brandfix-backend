import { env } from "../config/env";

type ChatRole = "system" | "user";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface OpenAiCompletionOptions {
  messages: ChatMessage[];
  temperature?: number;
  jsonMode?: boolean;
}

interface OpenAiCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

export async function createOpenAiCompletion({
  messages,
  temperature = 0.2,
  jsonMode = false,
}: OpenAiCompletionOptions): Promise<string> {
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on server");
  }

  const response = await fetch(
    `${env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        temperature,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as OpenAiCompletionResponse;
  const first = payload.choices?.[0]?.message?.content;

  if (typeof first === "string") {
    return first;
  }

  if (Array.isArray(first)) {
    const content = first
      .map((chunk) => (typeof chunk?.text === "string" ? chunk.text : ""))
      .join("")
      .trim();
    if (content) {
      return content;
    }
  }

  throw new Error("OpenAI response did not contain message content");
}

export function parseModelJsonObject(value: string): Record<string, unknown> {
  const cleaned = stripCodeFence(value.trim());
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model response is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function stripCodeFence(value: string): string {
  if (!value.startsWith("```")) {
    return value;
  }

  const lines = value.split("\n");
  if (lines.length <= 2) {
    return value;
  }

  return lines.slice(1, lines.length - 1).join("\n").trim();
}

