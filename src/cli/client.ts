import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Connection {
  url: string;
  pid: number;
}

export function readConnection(home: string): Connection {
  try {
    return JSON.parse(readFileSync(join(home, "connection.json"), "utf8"));
  } catch {
    throw new Error("服务未启动，请先运行 sidenote start");
  }
}

/** Minimal client for the local service. */
export class ApiClient {
  constructor(private home: string) {}
  get connection() {
    return readConnection(this.home);
  }
  async request<T>(method: "GET" | "POST", path: string, body?: unknown) {
    const c = this.connection;
    const res = await fetch(`${c.url}/api/${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
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
}
