import Fastify from "fastify";
import { acquireLock } from "../infrastructure/lock.js";
import { readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Store } from "../infrastructure/store.js";
import { Service } from "../application/service.js";
export async function createServer(home: string, port = 47831) {
  const releaseLock = acquireLock(home);
  const store = new Store(home);
  const service = new Service(store);
  const app = Fastify({ logger: false, bodyLimit: 32768 });
  const tokenPath = join(home, "token");
  let token: string;
  try {
    token = readFileSync(tokenPath, "utf8").trim();
  } catch {
    token = randomBytes(32).toString("hex");
    writeFileSync(tokenPath, token, { mode: 0o600 });
  }
  let actualPort = port;
  const authorized = (value: unknown) =>
    typeof value === "string" &&
    Buffer.byteLength(value) === Buffer.byteLength(token) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(token));
  app.addHook("onRequest", async (req, reply) => {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${actualPort}`)
      return reply.code(403).send({ error: "Invalid host" });
    if (
      req.headers.origin &&
      req.headers.origin !== `http://127.0.0.1:${actualPort}`
    )
      return reply.code(403).send({ error: "Invalid origin" });
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    );
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    if (
      req.url.startsWith("/api/") &&
      !authorized(req.headers.authorization?.replace(/^Bearer /, ""))
    )
      return reply.code(401).send({ error: "Unauthorized" });
  });
  app.setErrorHandler((error, req, reply) => {
    const message = error instanceof Error ? error.message : "Request failed";
    reply.code(400).send({ error: message.slice(0, 300) });
  });
  const assets = fileURLToPath(new URL("../../public/", import.meta.url));
  for (const [route, file, type] of [
    ["/", "index.html", "text/html"],
    ["/app.js", "app.js", "text/javascript"],
    ["/style.css", "style.css", "text/css"],
  ])
    app.get(route, async (_, reply) =>
      reply.type(type).send(await readFile(join(assets, file), "utf8")),
    );
  app.get("/api/status", async () => ({
    name: "source-sidenote",
    version: "0.1.0",
  }));
  app.get("/api/config", async () => {
    const { apiKey, ...c } = store.config();
    return { ...c, hasApiKey: Boolean(apiKey) };
  });
  app.put("/api/config", async (req) => {
    const b = req.body as any;
    const old = store.config();
    if (!b || typeof b.baseUrl !== "string" || typeof b.model !== "string")
      throw new Error("baseUrl and model required");
    const url = new URL(b.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid model URL");
    if (
      url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error("Remote model endpoints must use HTTPS");
    const c = { ...old, baseUrl: b.baseUrl, model: b.model.trim() };
    if ("apiKey" in b) {
      if (typeof b.apiKey !== "string") throw new Error("Invalid API key");
      c.apiKey = b.apiKey;
    }
    for (const [key, min, max] of [
      ["concurrency", 1, 4],
      ["maxFilesPerRun", 1, 1000],
      ["timeoutMs", 1000, 180000],
    ] as const) {
      if (b[key] !== undefined) {
        if (!Number.isInteger(b[key]) || b[key] < min || b[key] > max)
          throw new Error(`Invalid ${key}`);
        c[key] = b[key];
      }
    }
    store.saveConfig(c);
    return { ok: true };
  });
  app.get("/api/projects", () => service.projects());
  app.post("/api/projects", async (req) => {
    const b = req.body as any;
    if (typeof b?.root !== "string") throw new Error("root required");
    return service.add(b.root);
  });
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/refresh",
    async (req) => {
      await service.refresh(req.params.id);
      return { ok: true };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/files",
    async (req) => {
      store.project(req.params.id);
      return store.files(req.params.id);
    },
  );
  app.post<{ Params: { id: string } }>("/api/projects/:id/run", async (req) => {
    const b = (req.body || {}) as any;
    if (b.kind && !["generate", "review"].includes(b.kind))
      throw new Error("Invalid task kind");
    if (b.path !== undefined && typeof b.path !== "string")
      throw new Error("Invalid path");
    return service.run(req.params.id, b.kind, b.path);
  });
  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    "/api/projects/:id/document",
    (req) => service.document(req.params.id, req.query.path),
  );
  app.get("/api/jobs", () => store.jobs());
  app.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (req) => {
    service.cancel(req.params.id);
    return { ok: true };
  });
  const streams = new Set<import("node:http").ServerResponse>();
  app.addHook("preClose", async () => {
    for (const stream of streams) stream.end();
  });
  app.get("/api/events", async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    streams.add(reply.raw);
    const send = () => reply.raw.write('data: {"type":"change"}\n\n');
    send();
    service.on("change", send);
    const timer = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15000);
    req.raw.on("close", () => {
      clearInterval(timer);
      service.off("change", send);
      streams.delete(reply.raw);
    });
  });
  app.post("/api/stop", async () => {
    setTimeout(() => void app.close(), 100);
    return { ok: true };
  });
  app.addHook("onClose", async () => {
    await service.stop();
    store.close();
    try {
      unlinkSync(join(home, "connection.json"));
    } catch {}
    releaseLock();
  });
  try {
    await app.listen({ host: "127.0.0.1", port });
  } catch (error) {
    await app.close();
    releaseLock();
    throw error;
  }
  const address = app.server.address();
  actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://127.0.0.1:${actualPort}`;
  writeFileSync(
    join(home, "connection.json"),
    JSON.stringify({ url, pid: process.pid }),
    { mode: 0o600 },
  );
  service.start();
  return { app, service, store, url, token };
}
