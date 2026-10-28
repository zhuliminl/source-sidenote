import Fastify from "fastify";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { acquireLock } from "../../infrastructure/lock.js";
import { createContainer } from "../../application/container.js";
import { loadToken, registerSecurity } from "./security.js";
import { registerErrorHandler } from "./errors.js";
import { registerRoutes } from "./routes.js";
import { registerWebApp } from "./static.js";

export const DEFAULT_PORT = 47831;

/** Starts the single local service for a data directory (port 0 = ephemeral, for tests). */
export async function createServer(home: string, port = DEFAULT_PORT) {
  const releaseLock = acquireLock(home);
  let container;
  try {
    container = createContainer(home);
  } catch (error) {
    releaseLock();
    throw error;
  }
  const c = container;
  const token = loadToken(home);
  const app = Fastify({ logger: false, bodyLimit: 32768 });
  let actualPort = port;

  registerSecurity(app, { token, port: () => actualPort });
  registerErrorHandler(app);
  registerRoutes(app, c, () => void app.close());
  await registerWebApp(app);

  app.addHook("onClose", async () => {
    await c.worker.stop();
    c.close();
    try {
      unlinkSync(join(home, "connection.json"));
    } catch {}
    releaseLock();
  });

  try {
    await app.listen({ host: "127.0.0.1", port });
  } catch (error) {
    await app.close();
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
  c.worker.start();
  return { app, container: c, url, token };
}
