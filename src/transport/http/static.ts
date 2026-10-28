import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Vite builds the web app into dist/web (see web/vite.config.ts).
const webRoot = fileURLToPath(new URL("../../web/", import.meta.url));

/** Serves the built web app with SPA fallback; API 404s stay JSON. */
export async function registerWebApp(app: FastifyInstance) {
  const built = existsSync(webRoot + "index.html");
  if (built)
    await app.register(fastifyStatic, {
      root: webRoot,
      wildcard: false,
      index: "index.html",
    });
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== "GET" || req.url.startsWith("/api/"))
      return reply.code(404).send({ error: "Not found" });
    if (!built)
      return reply
        .code(503)
        .type("text/plain; charset=utf-8")
        .send("管理页尚未构建：请运行 npm run build");
    return reply.type("text/html").sendFile("index.html");
  });
}
