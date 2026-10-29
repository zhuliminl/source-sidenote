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
  PromptView,
  RunResult,
  SourceView,
  StatusView,
  TopicSummary,
  TopicView,
} from "../../shared/api.js";
import type { Container } from "../../application/container.js";
import type { ChangeTopic } from "../../application/events.js";
import { VERSION } from "../../version.js";

const idParams = z.object({ id: z.string().min(1) });
const addBody = z.object({ root: z.string().min(1) });
const pathQuery = z.object({ path: z.string().min(1) });
const text = z.string().max(4000);
const topicCreate = z.object({ request: text, instructions: text.optional() });
const topicReplan = z.object({ instructions: text.optional() }).default({});
const topicConfirm = z.object({
  files: z
    .array(z.object({ path: z.string().min(1), reason: z.string() }))
    .max(100),
  instructions: text.optional(),
});
const fileRun = z.object({
  path: z.string().min(1),
  kind: z.enum(["generate", "review"]),
});

export function registerRoutes(
  app: FastifyInstance,
  c: Container,
  shutdown: () => void,
) {
  const {
    projectService: projects,
    topicService: topics,
    configService: config,
    worker,
  } = c;

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

  app.get("/api/prompts", async (): Promise<PromptView[]> => topics.prompts());

  app.get("/api/projects", async (): Promise<ProjectSummary[]> =>
    projects.list(),
  );
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
  app.get("/api/projects/:id/files", async (req): Promise<FileEntry[]> =>
    projects.files(idParams.parse(req.params).id),
  );
  app.get("/api/projects/:id/source", (req): Promise<SourceView> =>
    projects.source(
      idParams.parse(req.params).id,
      pathQuery.parse(req.query).path,
    ),
  );

  app.get("/api/projects/:id/topics", (req): Promise<TopicSummary[]> =>
    topics.list(idParams.parse(req.params).id),
  );
  app.post("/api/projects/:id/topics", (req): Promise<TopicView> =>
    topics.create(idParams.parse(req.params).id, topicCreate.parse(req.body)),
  );
  app.get("/api/topics/:id", (req): Promise<TopicView> =>
    topics.get(idParams.parse(req.params).id),
  );
  app.delete("/api/topics/:id", async (req) => {
    topics.remove(idParams.parse(req.params).id);
    return { ok: true };
  });
  app.post("/api/topics/:id/plan", (req): Promise<TopicView> =>
    topics.replan(
      idParams.parse(req.params).id,
      topicReplan.parse(req.body ?? {}).instructions,
    ),
  );
  app.post("/api/topics/:id/confirm", (req): Promise<RunResult> =>
    topics.confirm(idParams.parse(req.params).id, topicConfirm.parse(req.body)),
  );
  app.post("/api/topics/:id/refresh", (req): Promise<RunResult> =>
    topics.refresh(idParams.parse(req.params).id),
  );
  app.post("/api/topics/:id/run", (req): Promise<RunResult> => {
    const { path, kind } = fileRun.parse(req.body);
    return topics.runFile(idParams.parse(req.params).id, path, kind);
  });
  app.get("/api/topics/:id/document", (req): Promise<DocumentView> =>
    topics.document(
      idParams.parse(req.params).id,
      pathQuery.parse(req.query).path,
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
