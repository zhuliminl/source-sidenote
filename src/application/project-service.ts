import { basename } from "node:path";
import { realpath } from "node:fs/promises";
import type {
  AddProjectResult,
  DocumentView,
  FileEntry,
  JobKind,
  ProjectSummary,
  RunResult,
  SourceView,
} from "../shared/api.js";
import { parseReview, type Project } from "../domain/model.js";
import { badRequest, notFound } from "../domain/errors.js";
import { safeRead } from "../infrastructure/source/files.js";
import type {
  DocumentRepository,
  FileRepository,
  JobRepository,
  ProjectRepository,
} from "../infrastructure/persistence/repositories.js";
import type { ConfigStore } from "../infrastructure/persistence/config-store.js";
import { scan } from "../infrastructure/source/scanner.js";
import { isFresh, snapshot, trySnapshot } from "./freshness.js";
import type { AppEvents } from "./events.js";

export interface ProjectDeps {
  projects: ProjectRepository;
  files: FileRepository;
  docs: DocumentRepository;
  jobs: JobRepository;
  config: ConfigStore;
  events: AppEvents;
}

export class ProjectService {
  constructor(private deps: ProjectDeps) {}

  /** Registers a directory (by realpath) and schedules missing/stale explanations. */
  async add(directory: string): Promise<AddProjectResult> {
    let root: string;
    try {
      root = await realpath(directory);
    } catch {
      throw badRequest("目录不存在或无法访问");
    }
    const project = this.deps.projects.register(root, basename(root));
    return { project, ...(await this.schedule(project.id)) };
  }

  async rescan(id: string) {
    const project = this.deps.projects.get(id);
    const files = await scan(project.root);
    this.deps.files.replace(id, files);
    this.deps.events.changed("projects");
    return { project, files };
  }

  remove(id: string) {
    this.deps.projects.get(id);
    this.deps.projects.remove(id);
    this.deps.events.changed("projects");
  }

  /**
   * generate: queue missing/stale files (or `only`, even if fresh = forced refresh).
   * review: queue fresh explanations for an AI second opinion.
   */
  async schedule(
    id: string,
    kind: JobKind = "generate",
    only?: string,
  ): Promise<RunResult> {
    const { project, files } = await this.rescan(id);
    if (only && !files.some((f) => f.path === only))
      throw badRequest("File excluded or unsupported");
    const config = this.deps.config.get();
    if (!config.model) return { queued: 0, blocked: "请先在设置中配置模型" };
    const docs = this.deps.docs.listByProject(id);
    let queued = 0;
    for (const f of files) {
      if (only && f.path !== only) continue;
      if (queued >= config.maxFilesPerRun) break;
      const d = docs.get(f.path);
      const s = d && (await trySnapshot(project.root, files, f.path));
      const fresh = Boolean(s && isFresh(d, s, config.model));
      if (kind === "review" && !fresh) continue;
      if (kind === "generate" && fresh && !only) continue;
      queued += this.deps.jobs.enqueue(id, f.path, kind);
    }
    if (queued) this.deps.events.changed("jobs");
    return { queued, blocked: null };
  }

  async list(): Promise<ProjectSummary[]> {
    return Promise.all(this.deps.projects.list().map((p) => this.summary(p)));
  }

  private async summary(p: Project): Promise<ProjectSummary> {
    const entries = await this.fileEntries(p);
    const count = (pred: (e: FileEntry) => boolean) =>
      entries.filter(pred).length;
    const docs = this.deps.docs.listByProject(p.id);
    return {
      ...p,
      total: entries.length,
      covered: count((e) => e.status !== "missing"),
      fresh: count((e) => e.status === "fresh"),
      reviewed: count(
        (e) =>
          e.status === "fresh" &&
          parseReview(docs.get(e.path)!.review)?.verdict === "pass",
      ),
      unavailable: entries.some((e) => e.status === "unavailable"),
    };
  }

  async files(id: string): Promise<FileEntry[]> {
    return this.fileEntries(this.deps.projects.get(id));
  }

  private async fileEntries(p: Project): Promise<FileEntry[]> {
    const files = this.deps.files.list(p.id);
    const docs = this.deps.docs.listByProject(p.id);
    const { model } = this.deps.config.get();
    // Only documented files need to be read from disk to judge freshness.
    return Promise.all(
      files.map(async (f): Promise<FileEntry> => {
        const d = docs.get(f.path);
        if (!d) return { path: f.path, bytes: f.bytes, status: "missing" };
        const s = await trySnapshot(p.root, files, f.path);
        return {
          path: f.path,
          bytes: f.bytes,
          status: !s ? "unavailable" : isFresh(d, s, model) ? "fresh" : "stale",
        };
      }),
    );
  }

  /** Source text for the reader; only files inside the scanned scope are served. */
  async source(id: string, path: string): Promise<SourceView> {
    const p = this.deps.projects.get(id);
    const file = this.deps.files.list(id).find((f) => f.path === path);
    if (!file) throw notFound("File not in project scope");
    const content = await safeRead(p.root, path);
    return { path, content, bytes: Buffer.byteLength(content) };
  }

  async document(id: string, path: string): Promise<DocumentView> {
    const p = this.deps.projects.get(id);
    const d = this.deps.docs.get(id, path);
    if (!d) return { status: "missing", path, markdown: "" };
    const s = await snapshot(p.root, this.deps.files.list(id), path);
    return {
      status: isFresh(d, s, this.deps.config.get().model) ? "fresh" : "stale",
      path,
      markdown: d.markdown,
      explanation: JSON.parse(d.payload),
      model: d.model,
      generated: d.generated,
      review: parseReview(d.review),
    };
  }
}
