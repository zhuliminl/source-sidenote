import type { FastifyInstance } from "fastify";
import type { ServerResponse } from "node:http";
import { z } from "zod";
import type {
  AddProjectResult,
  ConfigView,
  DocumentView,
  FileEntry,
  JobView,
  ProjectSummary,
  RunResult,
  StatusView,
} from "../../shared/api.js";
import type { Container } from "../../application/container.js";
import type { ChangeTopic } from "../../application/events.js";
import { VERSION } from "../../version.js";

const idParams = z.object({ id: z.string().min(1) });
const addBody = z.object({ root: z.string().min(1) });
const runBody = z
  .object({
    kind: z.enum(["generate", "review"]).optional(),
    path: z.string().min(1).optional(),
  })
  .default({});
const documentQuery = z.object({ path: z.string().min(1) });

export function registerRoutes(
  app: FastifyInstance,
  c: Container,
  shutdown: () => void,
) {
  const { projectService: projects, configService: config, worker } = c;

  app.get("/api/status", async (): Promise<StatusView> => ({
    name: "source-sidenote",
    version: VERSION,
  }));
  app.post("/api/stop", async () => {
    setTimeout(shutdown, 100);
    return { ok: true };
  });

  app.get("/api/config", async (): Promise<ConfigView> => config.view());
  app.put("/api/config", async (req) => {
    config.update(req.body);
    return { ok: true };
  });

  app.get("/api/projects", (): Promise<ProjectSummary[]> => projects.list());
  app.post("/api/projects", (req): Promise<AddProjectResult> =>
    projects.add(addBody.parse(req.body).root),
  );
  app.delete("/api/projects/:id", async (req) => {
    projects.remove(idParams.parse(req.params).id);
    return { ok: true };
  });
  app.post("/api/projects/:id/refresh", async (req) => {
    await projects.rescan(idParams.parse(req.params).id);
    return { ok: true };
  });
  app.post("/api/projects/:id/run", (req): Promise<RunResult> => {
    const { kind, path } = runBody.parse(req.body ?? {});
    return projects.schedule(idParams.parse(req.params).id, kind, path);
  });
  app.get("/api/projects/:id/files", (req): Promise<FileEntry[]> =>
    projects.files(idParams.parse(req.params).id),
  );
  app.get("/api/projects/:id/document", (req): Promise<DocumentView> =>
    projects.document(
      idParams.parse(req.params).id,
      documentQuery.parse(req.query).path,
    ),
  );

  app.get("/api/jobs", async (): Promise<JobView[]> => c.jobs.recent());
  app.post("/api/jobs/:id/cancel", async (req) => {
    worker.cancel(idParams.parse(req.params).id);
    return { ok: true };
  });

  // Server-sent events: `data: {"type":"change","topic":"jobs"}`.
  const streams = new Set<ServerResponse>();
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
    const send = (topic: ChangeTopic | "hello") =>
      reply.raw.write(`data: ${JSON.stringify({ type: "change", topic })}\n\n`);
    send("hello");
    c.events.on("change", send);
    const heartbeat = setInterval(
      () => reply.raw.write(": heartbeat\n\n"),
      15000,
    );
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      c.events.off("change", send);
      streams.delete(reply.raw);
    });
  });
}
