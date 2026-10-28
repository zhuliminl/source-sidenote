import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../../domain/errors.js";

/** Maps thrown errors to `{ error }` JSON with a meaningful status code. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const where = issue?.path.join(".");
      return reply
        .code(400)
        .send({ error: where ? `${where}: ${issue.message}` : issue.message });
    }
    const status =
      error instanceof AppError
        ? error.statusCode
        : (error as { statusCode?: number }).statusCode;
    const message = error instanceof Error ? error.message : "Request failed";
    reply
      .code(status && status >= 400 && status < 600 ? status : 500)
      .send({ error: message.slice(0, 300) });
  });
}
