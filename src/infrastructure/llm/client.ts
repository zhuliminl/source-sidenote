import type { Connection } from "../../domain/model.js";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const base = (c: Connection) => c.baseUrl.replace(/\/$/, "");

/**
 * OpenAI keeps the version in the base URL (".../v1"); Anthropic-style bases stop
 * before it ("https://api.anthropic.com"), matching how both SDKs are configured.
 */
function request(c: Connection, path: "chat" | "models", body?: unknown) {
  const anthropic = c.format === "anthropic-messages";
  const url =
    base(c) +
    (anthropic
      ? path === "chat"
        ? "/v1/messages"
        : "/v1/models"
      : path === "chat"
        ? "/chat/completions"
        : "/models");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (anthropic) {
    headers["anthropic-version"] = "2023-06-01";
    if (c.apiKey) headers["x-api-key"] = c.apiKey;
  } else if (c.apiKey) headers.Authorization = `Bearer ${c.apiKey}`;
  return {
    url,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

async function send(
  c: Connection,
  path: "chat" | "models",
  body: unknown,
  signal?: AbortSignal,
): Promise<any> {
  const timeout = AbortSignal.timeout(c.timeoutMs);
  const r = request(c, path, body);
  const res = await fetch(r.url, {
    method: body ? "POST" : "GET",
    headers: r.headers,
    body: r.body,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  // Never echo provider response bodies: they can contain credentials or private source.
  if (!res.ok) throw new Error(`Model HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    // JSON.parse errors quote the start of the body; keep it out of job errors.
    throw new Error("Model response is not valid JSON");
  }
}

/** Sends one prompt and returns the model's JSON output. */
export async function completeJson(
  c: Connection,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<unknown> {
  const anthropic = c.format === "anthropic-messages";
  const body = anthropic
    ? {
        model: c.model,
        system: messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n"),
        messages: messages
          .filter((m) => m.role === "user")
          .map((m) => ({ role: "user", content: m.content })),
        temperature: 0.2,
        max_tokens: 3000,
      }
    : { model: c.model, messages, temperature: 0.2, max_tokens: 3000 };
  const res = await send(c, "chat", body, signal);
  const text = anthropic
    ? Array.isArray(res?.content)
      ? res.content
          .filter((b: any) => b?.type === "text")
          .map((b: any) => b.text)
          .join("")
      : undefined
    : res?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text)
    throw new Error("Model returned no text");
  try {
    return JSON.parse(
      text.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""),
    );
  } catch {
    throw new Error("Model output is not valid JSON");
  }
}

/** Model ids the provider lists; both protocols answer with {data: [{id}]}. */
export async function listModels(c: Connection): Promise<string[]> {
  const res = await send(c, "models", undefined);
  if (!Array.isArray(res?.data)) throw new Error("Model list is not available");
  return [
    ...new Set<string>(
      res.data
        .map((m: any) => m?.id)
        .filter((id: unknown): id is string => typeof id === "string" && !!id),
    ),
  ];
}
