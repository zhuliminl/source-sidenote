import type { Job } from "../domain/model.js";
import { PROMPT_VERSION } from "../domain/model.js";
import type { Explanation } from "../shared/api.js";
import {
  keepKnownRelations,
  renderMarkdown,
  validateExplanation,
  validateOverview,
  validatePlan,
  validateReview,
} from "../domain/explanation.js";
import { completeJson } from "../infrastructure/llm/client.js";
import {
  explanationMessages,
  overviewMessages,
  planMessages,
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
    try {
      if (job.kind === "plan") await this.plan(job, signal);
      else if (job.kind === "overview") await this.overview(job, signal);
      else await this.explain(job, signal);
      this.deps.jobs.finish(job.id, "done");
    } catch (error) {
      // Errors crossing the model boundary are sanitized in llm/client.ts; do not persist source text.
      const message = (
        error instanceof Error ? error.message : "Task failed"
      ).slice(0, 300);
      const state = this.stopped
        ? "queued"
        : signal.aborted
          ? "cancelled"
          : "failed";
      this.deps.jobs.finish(job.id, state, message);
      if (
        job.kind === "plan" &&
        state !== "queued" &&
        this.deps.topics.find(job.topic)
      ) {
        this.deps.topics.update(job.topic, {
          state: "plan_failed",
          error: state === "cancelled" ? "规划已取消" : message,
        });
        this.deps.events.changed("topics");
      }
    }
  }

  private async plan(job: Job, signal: AbortSignal) {
    const { projects, files, topics, config } = this.deps;
    const topic = topics.get(job.topic);
    const p = projects.get(job.project);
    const manifest = files.list(job.project);
    const cfg = config.get();
    const result = await completeJson(
      cfg,
      planMessages(
        topic,
        await projectOverview(p.root, manifest),
        cfg.maxFilesPerTopic,
      ),
      signal,
    );
    signal.throwIfAborted();
    const plan = validatePlan(
      result,
      new Set(manifest.map((f) => f.path)),
      cfg.maxFilesPerTopic,
    );
    if (!topics.find(job.topic)) return;
    topics.setFiles(job.topic, plan.files);
    topics.update(job.topic, {
      title: plan.title || topic.title,
      plan: plan.plan,
      state: "planned",
      error: null,
    });
    this.deps.events.changed("topics");
  }

  private async explain(job: Job, signal: AbortSignal) {
    const { projects, files, topics, docs, config } = this.deps;
    const topic = topics.get(job.topic);
    const chain = topics
      .files(job.topic)
      .map(({ path, reason }) => ({ path, reason }));
    if (!chain.some((f) => f.path === job.path))
      throw new Error("File is not part of this topic");
    const p = projects.get(job.project);
    const manifest = files.list(job.project);
    if (!manifest.some((f) => f.path === job.path))
      throw new Error("File excluded or removed");
    const before = await snapshot(p.root, manifest, job.path);
    const cfg = config.get();
    const existing = docs.get(job.topic, job.path);
    if (
      job.kind === "review" &&
      (!existing || !isFresh(existing, before, cfg.model))
    )
      throw new Error("Explanation is stale; regenerate before review");

    const result = await completeJson(
      cfg,
      job.kind === "review"
        ? reviewMessages(
            topic,
            before.source,
            JSON.parse(existing!.payload),
            before.deps.text,
          )
        : explanationMessages(
            topic,
            chain,
            job.path,
            before.source,
            before.deps.text,
          ),
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
      throw new Error("Source changed during generation; regenerate");
    // The topic may have been deleted while the model was answering.
    if (!topics.find(job.topic)) return;

    if (job.kind === "review") {
      const review = validateReview(result);
      docs.saveReview(
        job.topic,
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
        topic: job.topic,
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
      this.queueOverviewWhenComplete(job);
    }
    this.deps.events.changed("topics");
  }

  /** The walkthrough is written once every file of the topic has an explanation. */
  private queueOverviewWhenComplete(job: Job) {
    const { topics, docs, jobs } = this.deps;
    const others = jobs
      .pending(job.topic)
      .filter((j) => j.id !== job.id && j.kind === "generate");
    if (others.length) return;
    const explained = docs.listByTopic(job.topic);
    if (topics.files(job.topic).every((f) => explained.has(f.path)))
      jobs.enqueue(job.project, job.topic, "", "overview");
  }

  private async overview(job: Job, signal: AbortSignal) {
    const { topics, docs, config } = this.deps;
    const topic = topics.get(job.topic);
    const explained = docs.listByTopic(job.topic);
    const files = topics.files(job.topic).flatMap((f) => {
      const d = explained.get(f.path);
      if (!d) return [];
      const e = JSON.parse(d.payload) as Explanation;
      return [
        { path: f.path, reason: f.reason, summary: e.summary, flow: e.flow },
      ];
    });
    if (!files.length) throw new Error("No explanations to summarize yet");
    const result = await completeJson(
      config.get(),
      overviewMessages(topic, files),
      signal,
    );
    signal.throwIfAborted();
    const overview = validateOverview(
      result,
      new Set(files.map((f) => f.path)),
    );
    if (!topics.find(job.topic)) return;
    topics.update(job.topic, { overview: JSON.stringify(overview) });
    this.deps.events.changed("topics");
  }
}
