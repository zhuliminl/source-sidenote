import { basename } from "node:path";
import { realpath } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { Store } from "../infrastructure/store.js";
import {
  scan,
  context,
  dependencyContext,
  hash,
  safeRead,
} from "../infrastructure/scanner.js";
import {
  complete,
  explanationMessages,
  reviewMessages,
} from "../infrastructure/model.js";
import {
  PROMPT_VERSION,
  markdown,
  validateExplanation,
  type SourceFile,
} from "../domain/types.js";
// Freshness is defined once here: source text hash + direct dependency fingerprint + prompt version.
async function snapshot(root: string, files: SourceFile[], path: string) {
  const source = await safeRead(root, path);
  const deps = await dependencyContext(root, files, path, source);
  return { source, hash: hash(source), deps };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
function isFresh(d: any, s: Snapshot): boolean {
  return Boolean(
    d &&
    d.hash === s.hash &&
    d.context === s.deps.fingerprint &&
    d.version === PROMPT_VERSION,
  );
}
export class Service extends EventEmitter {
  active = new Map<string, AbortController>();
  timer?: NodeJS.Timeout;
  stopped = false;
  constructor(public store: Store) {
    super();
  }
  async add(path: string) {
    const root = await realpath(path);
    const p = this.store.register(root, basename(root));
    return { project: p, ...(await this.run(p.id)) };
  }
  async refresh(id: string) {
    const p = this.store.project(id);
    const files = await scan(p.root);
    this.store.sync(id, files);
    return { p, files };
  }
  async run(id: string, kind = "generate", only?: string) {
    const { p, files } = await this.refresh(id);
    if (only && !files.some((f) => f.path === only))
      throw new Error("File excluded or unsupported");
    const config = this.store.config();
    if (!config.model) return { queued: 0, blocked: "请先在管理页配置模型" };
    let queued = 0;
    for (const f of files) {
      if (only && f.path !== only) continue;
      if (queued >= config.maxFilesPerRun) break;
      const d = this.store.doc(id, f.path);
      const fresh = d
        ? isFresh(d, await snapshot(p.root, files, f.path))
        : false;
      if (kind === "review" && !fresh) continue;
      if (kind === "generate" && fresh && !only) continue;
      queued += this.store.enqueue(id, f.path, kind);
    }
    this.emit("change");
    return { queued, blocked: null };
  }
  async projects() {
    const rows = this.store.db
      .prepare("SELECT * FROM projects ORDER BY created DESC")
      .all();
    return Promise.all(
      rows.map(async (p: any) => {
        const files = this.store.files(p.id);
        let unavailable = false;
        let covered = 0,
          fresh = 0,
          reviewed = 0;
        for (const f of files) {
          const d = this.store.doc(p.id, f.path);
          if (!d) continue;
          covered++;
          let s: Snapshot;
          try {
            s = await snapshot(p.root, files, f.path);
          } catch {
            unavailable = true;
            continue;
          }
          if (isFresh(d, s)) {
            fresh++;
            if (d.review && JSON.parse(d.review).verdict === "pass") reviewed++;
          }
        }
        return {
          ...p,
          total: files.length,
          covered,
          fresh,
          reviewed,
          unavailable,
        };
      }),
    );
  }
  async document(id: string, path: string) {
    const p = this.store.project(id);
    const d = this.store.doc(id, path);
    if (!d) return { status: "missing", markdown: "" };
    const s = await snapshot(p.root, this.store.files(id), path);
    return { ...d, status: isFresh(d, s) ? "fresh" : "stale" };
  }
  start() {
    this.timer = setInterval(() => this.tick(), 300);
    this.tick();
  }
  tick() {
    if (this.stopped || !this.store.config().model) return;
    while (this.active.size < this.store.config().concurrency) {
      const job: any = this.store.db
        .prepare(
          "SELECT * FROM jobs WHERE state='queued' ORDER BY created LIMIT 1",
        )
        .get();
      if (!job) break;
      this.store.db
        .prepare(
          "UPDATE jobs SET state='running',attempts=attempts+1,error=NULL WHERE id=?",
        )
        .run(job.id);
      const abort = new AbortController();
      this.active.set(job.id, abort);
      this.execute(job, abort.signal)
        .catch(() => {})
        .finally(() => {
          this.active.delete(job.id);
          this.emit("change");
        });
    }
  }
  async execute(job: any, signal: AbortSignal) {
    try {
      const p = this.store.project(job.project);
      const files = this.store.files(job.project);
      if (!files.some((f) => f.path === job.path))
        throw new Error("File excluded or removed");
      const before = await snapshot(p.root, files, job.path);
      const ctx = `${await context(p.root, files)}\n${before.deps.text}`;
      const cfg = this.store.config();
      const existing = this.store.doc(job.project, job.path);
      if (job.kind === "review" && !isFresh(existing, before))
        throw new Error("Explanation is stale; regenerate before review");
      const result: any = await complete(
        cfg,
        job.kind === "review"
          ? reviewMessages(before.source, JSON.parse(existing.payload), ctx)
          : explanationMessages(job.path, before.source, ctx),
        signal,
      );
      signal.throwIfAborted();
      const current = this.store.files(job.project);
      if (!current.some((f) => f.path === job.path))
        throw new Error("File removed from project scope");
      const after = await snapshot(p.root, current, job.path);
      if (
        after.hash !== before.hash ||
        after.deps.fingerprint !== before.deps.fingerprint
      )
        throw new Error("Source changed during generation; rerun add");
      if (job.kind === "review") {
        if (
          !["pass", "needs_changes"].includes(result?.verdict) ||
          !Array.isArray(result.issues) ||
          !result.issues.every((v: unknown) => typeof v === "string") ||
          (result.verdict === "pass" && result.issues.length)
        )
          throw new Error("Invalid review result");
        this.store.db
          .prepare(
            "UPDATE docs SET review=? WHERE project=? AND path=? AND generated=?",
          )
          .run(
            JSON.stringify({
              ...result,
              model: cfg.model,
              checked: new Date().toISOString(),
            }),
            job.project,
            job.path,
            existing.generated,
          );
      } else {
        const e = validateExplanation(result, before.source.split("\n").length);
        const known = new Set(files.map((f) => f.path));
        if (e.relations.some((r) => !known.has(r.path)))
          throw new Error("Explanation references unknown source files");
        this.store.db
          .prepare("INSERT OR REPLACE INTO docs VALUES(?,?,?,?,?,?,?,?,?,NULL)")
          .run(
            job.project,
            job.path,
            before.hash,
            before.deps.fingerprint,
            PROMPT_VERSION,
            cfg.model,
            markdown(e, job.path),
            JSON.stringify(e),
            new Date().toISOString(),
          );
      }
      this.store.db
        .prepare("UPDATE jobs SET state='done' WHERE id=?")
        .run(job.id);
    } catch (error) {
      const cancelled = signal.aborted;
      // Errors crossing the model boundary are sanitized in model.ts; do not persist source text.
      const message = error instanceof Error ? error.message : "Task failed";
      this.store.db
        .prepare("UPDATE jobs SET state=?,error=? WHERE id=?")
        .run(
          this.stopped ? "queued" : cancelled ? "cancelled" : "failed",
          message.slice(0, 300),
          job.id,
        );
    }
  }
  cancel(id: string) {
    this.active.get(id)?.abort();
    this.store.db
      .prepare(
        "UPDATE jobs SET state='cancelled' WHERE id=? AND state='queued'",
      )
      .run(id);
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const a of this.active.values()) a.abort();
    while (this.active.size) await new Promise((r) => setTimeout(r, 20));
  }
}
