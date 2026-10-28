import type { Job } from "../domain/model.js";
import { PROMPT_VERSION } from "../domain/model.js";
import {
  keepKnownRelations,
  renderMarkdown,
  validateExplanation,
  validateReview,
} from "../domain/explanation.js";
import { completeJson } from "../infrastructure/llm/client.js";
import {
  explanationMessages,
  reviewMessages,
} from "../infrastructure/llm/prompts.js";
import { projectOverview } from "../infrastructure/source/context.js";
import { isFresh, snapshot } from "./freshness.js";
import type { ProjectDeps } from "./project-service.js";

/**
 * Pulls queued jobs and calls the model, up to `concurrency` at a time.
 * Event-driven: woken when jobs are queued, config changes or a job finishes.
 */
export class JobWorker {
  private active = new Map<string, AbortController>();
  private stopped = true;
  private scheduled = false;
  // Coalesce bursts of change events (including our own) into one pump per tick.
  private wake = () => {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      this.pump();
    });
  };

  constructor(private deps: ProjectDeps) {}

  start() {
    this.stopped = false;
    this.deps.jobs.requeueInterrupted();
    this.deps.jobs.pruneFinished();
    this.deps.events.on("change", this.wake);
    this.pump();
  }

  async stop() {
    this.stopped = true;
    this.deps.events.off("change", this.wake);
    for (const a of this.active.values()) a.abort();
    while (this.active.size) await new Promise((r) => setTimeout(r, 20));
  }

  cancel(id: string) {
    this.active.get(id)?.abort();
    this.deps.jobs.cancelQueued(id);
    this.deps.events.changed("jobs");
  }

  private pump() {
    if (this.stopped) return;
    const config = this.deps.config.get();
    if (!config.model) return;
    let claimed = 0;
    while (this.active.size < config.concurrency) {
      const job = this.deps.jobs.claimNext();
      if (!job) break;
      claimed++;
      const abort = new AbortController();
      this.active.set(job.id, abort);
      void this.execute(job, abort.signal).finally(() => {
        this.active.delete(job.id);
        this.deps.events.changed("jobs");
      });
    }
    if (claimed) this.deps.events.changed("jobs");
  }

  private async execute(job: Job, signal: AbortSignal) {
    const { projects, files, docs, jobs, config } = this.deps;
    try {
      const p = projects.get(job.project);
      const manifest = files.list(job.project);
      if (!manifest.some((f) => f.path === job.path))
        throw new Error("File excluded or removed");
      const before = await snapshot(p.root, manifest, job.path);
      const context = `${await projectOverview(p.root, manifest)}\n${before.deps.text}`;
      const cfg = config.get();
      const existing = docs.get(job.project, job.path);
      if (job.kind === "review" && (!existing || !isFresh(existing, before)))
        throw new Error("Explanation is stale; regenerate before review");

      const result = await completeJson(
        cfg,
        job.kind === "review"
          ? reviewMessages(
              before.source,
              JSON.parse(existing!.payload),
              context,
            )
          : explanationMessages(job.path, before.source, context),
        signal,
      );
      signal.throwIfAborted();

      // The model call can take minutes; refuse to write back an answer about old code.
      const current = files.list(job.project);
      if (!current.some((f) => f.path === job.path))
        throw new Error("File removed from project scope");
      const after = await snapshot(p.root, current, job.path);
      if (
        after.hash !== before.hash ||
        after.deps.fingerprint !== before.deps.fingerprint
      )
        throw new Error("Source changed during generation; rerun add");

      if (job.kind === "review") {
        const review = validateReview(result);
        docs.saveReview(
          job.project,
          job.path,
          existing!.generated,
          JSON.stringify({
            ...review,
            model: cfg.model,
            checked: new Date().toISOString(),
          }),
        );
      } else {
        const e = keepKnownRelations(
          validateExplanation(result, before.source.split("\n").length),
          new Set(current.map((f) => f.path)),
        );
        docs.save({
          project: job.project,
          path: job.path,
          hash: before.hash,
          context: before.deps.fingerprint,
          version: PROMPT_VERSION,
          model: cfg.model,
          markdown: renderMarkdown(e, job.path),
          payload: JSON.stringify(e),
          generated: new Date().toISOString(),
        });
      }
      jobs.finish(job.id, "done");
    } catch (error) {
      // Errors crossing the model boundary are sanitized in llm/client.ts; do not persist source text.
      const message = error instanceof Error ? error.message : "Task failed";
      jobs.finish(
        job.id,
        this.stopped ? "queued" : signal.aborted ? "cancelled" : "failed",
        message.slice(0, 300),
      );
    }
  }
}
