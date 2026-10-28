import type { FastifyInstance } from "fastify";

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
 * No login: the service binds to loopback only. Web pages are kept out by an exact
 * Host (defeats DNS rebinding) and same-Origin check (defeats cross-site requests).
 * Other processes of the local user are trusted, like any local dev tool.
 */
export function registerSecurity(
  app: FastifyInstance,
  options: { port: () => number },
) {
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
  });
}
