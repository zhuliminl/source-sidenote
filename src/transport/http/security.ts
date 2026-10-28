import type { FastifyInstance } from "fastify";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Loads the local bearer token, replacing missing, empty or truncated token files. */
export function loadToken(home: string): string {
  const path = join(home, "token");
  let token = "";
  try {
    token = readFileSync(path, "utf8").trim();
  } catch {}
  // An empty or truncated token file would make "Bearer " (or a trivial guess) authorize.
  if (token.length < 32) {
    token = randomBytes(32).toString("hex");
    writeFileSync(path, token, { mode: 0o600 });
  }
  return token;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Radix/sonner set inline style attributes and inject scroll-lock styles; scripts stay strict.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

/**
 * Loopback-only defenses: exact Host (DNS rebinding), same Origin (CSRF),
 * bearer token for every /api route.
 */
export function registerSecurity(
  app: FastifyInstance,
  options: { token: string; port: () => number },
) {
  const expected = Buffer.from(options.token);
  const authorized = (value: string | undefined) => {
    if (!value?.startsWith("Bearer ")) return false;
    const given = Buffer.from(value.slice(7));
    return given.length === expected.length && timingSafeEqual(given, expected);
  };
  app.addHook("onRequest", async (req, reply) => {
    const origin = `127.0.0.1:${options.port()}`;
    if (req.headers.host !== origin)
      return reply.code(403).send({ error: "Invalid host" });
    if (req.headers.origin && req.headers.origin !== `http://${origin}`)
      return reply.code(403).send({ error: "Invalid origin" });
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", CSP);
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    if (req.url.startsWith("/api/") && !authorized(req.headers.authorization))
      return reply.code(401).send({ error: "Unauthorized" });
  });
}
