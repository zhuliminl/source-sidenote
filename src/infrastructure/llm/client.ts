import type { ModelConfig } from "../../domain/model.js";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/** Calls an OpenAI-compatible Chat Completions endpoint and returns parsed JSON output. */
export async function completeJson(
  config: ModelConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const res = await fetch(
    config.baseUrl.replace(/\/$/, "") + "/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        max_tokens: 3000,
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    },
  );
  // Never echo provider response bodies: they can contain credentials or private source.
  if (!res.ok) throw new Error(`Model HTTP ${res.status}`);
  let body: any;
  try {
    body = await res.json();
  } catch {
    // JSON.parse errors quote the start of the body; keep it out of job errors.
    throw new Error("Model response is not valid JSON");
  }
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Model returned no text");
  try {
    return JSON.parse(
      text.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""),
    );
  } catch {
    throw new Error("Model output is not valid JSON");
  }
}
