import { basename } from "node:path";
import { realpath } from "node:fs/promises";
import type {
  AddProjectResult,
  FileEntry,
  ProjectSummary,
  SourceView,
} from "../shared/api.js";
import { badRequest, notFound } from "../domain/errors.js";
import { safeRead } from "../infrastructure/source/files.js";
import type {
  DocumentRepository,
  FileRepository,
  JobRepository,
  ProjectRepository,
  TopicRepository,
} from "../infrastructure/persistence/repositories.js";
import type { ConfigStore } from "../infrastructure/persistence/config-store.js";
import { scan } from "../infrastructure/source/scanner.js";
import type { AppEvents } from "./events.js";

export interface ProjectDeps {
  projects: ProjectRepository;
  files: FileRepository;
  topics: TopicRepository;
  docs: DocumentRepository;
  jobs: JobRepository;
  config: ConfigStore;
  events: AppEvents;
}

export class ProjectService {
  constructor(private deps: ProjectDeps) {}

  /** Registers a directory (by realpath) and scans it; explanations come from topics. */
  async add(directory: string): Promise<AddProjectResult> {
    let root: string;
    try {
      root = await realpath(directory);
    } catch {
      throw badRequest("目录不存在或无法访问");
    }
    const project = this.deps.projects.register(root, basename(root));
    await this.rescan(project.id);
    return { project };
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

  list(): ProjectSummary[] {
    return this.deps.projects.list().map((p) => {
      const files = this.deps.files.list(p.id);
      const coverage = this.deps.topics.coverage(p.id);
      return {
        ...p,
        total: files.length,
        covered: files.filter((f) => coverage.has(f.path)).length,
        topics: this.deps.topics.list(p.id).length,
      };
    });
  }

  /** In-scope files with the topics that explain them. */
  files(id: string): FileEntry[] {
    this.deps.projects.get(id);
    const coverage = this.deps.topics.coverage(id);
    return this.deps.files.list(id).map((f) => ({
      path: f.path,
      bytes: f.bytes,
      topics: coverage.get(f.path) ?? [],
    }));
  }

  /** Source text for the reader; only files inside the scanned scope are served. */
  async source(id: string, path: string): Promise<SourceView> {
    const p = this.deps.projects.get(id);
    const file = this.deps.files.list(id).find((f) => f.path === path);
    if (!file) throw notFound("File not in project scope");
    const content = await safeRead(p.root, path);
    return { path, content, bytes: Buffer.byteLength(content) };
  }
}
