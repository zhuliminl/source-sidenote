import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LocateResult } from "../../../src/shared/api";

/** The service is not running (no connection file or nothing listening). */
export class OfflineError extends Error {}

/** Same lookup as the service's dataDir(), with an optional editor override. */
export function dataDir(override?: string) {
  return (
    override ||
    process.env.SIDENOTE_HOME ||
    join(homedir(), ".local", "share", "source-sidenote")
  );
}

/**
 * Minimal HTTP client for the local service. No credentials: the service only
 * checks that Host is 127.0.0.1:<port>, which fetch derives from the URL.
 */
export class ApiClient {
  constructor(private home: () => string) {}

  async baseUrl(): Promise<string> {
    try {
      const text = await readFile(join(this.home(), "connection.json"), "utf8");
      return (JSON.parse(text) as { url: string }).url;
    } catch {
      throw new OfflineError(
        "Source Sidenote 服务未启动，请先运行 sidenote start",
      );
    }
  }

  async fetch(path: string, init: RequestInit = {}) {
    const url = `${await this.baseUrl()}/api/${path}`;
    try {
      return await fetch(url, init);
    } catch (e) {
      if (init.signal?.aborted) throw e;
      // connection.json can outlive a crashed service.
      throw new OfflineError(
        `无法连接 Source Sidenote 服务（${url}），请先运行 sidenote start`,
      );
    }
  }

  async request<T>(method: "GET" | "POST", path: string, body?: unknown) {
    const res = await this.fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data as T;
  }
  get<T>(path: string) {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body: unknown = {}) {
    return this.request<T>("POST", path, body);
  }

  /** Streams change topics from /api/events until the stream ends or `signal` aborts. */
  async subscribe(onTopic: (topic: string) => void, signal: AbortSignal) {
    const res = await this.fetch("events", { signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const data = event
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice(6);
        if (data) onTopic(JSON.parse(data).topic);
      }
    }
  }
}

/** Asks the service where an absolute path sits: project, scope and covering topics. */
export function locate(api: ApiClient, file: string) {
  return api.get<LocateResult>(`locate?path=${encodeURIComponent(file)}`);
}
