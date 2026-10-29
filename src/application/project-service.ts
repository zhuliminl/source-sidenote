import { basename, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import type {
  AddProjectResult,
  FileEntry,
  LocateResult,
  ProjectSummary,
  SourceView,
} from "../shared/api.js";
import { badRequest, notFound } from "../domain/errors.js";
import { safeRead } from "../infrastructure/source/files.js";
import type {
  DocumentRepository,
  FileRepository,
  JobRepository,
  StoryRepository,
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
  stories: StoryRepository;
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
  /** Maps an absolute path (as an editor sees it) to its project, scope and covering topics. */
  async locate(file: string): Promise<LocateResult> {
    // Project roots are stored as realpaths (e.g. /private/tmp on macOS).
    const full = await realpath(resolve(file)).catch(() => resolve(file));
    const fold = (s: string) =>
      process.platform === "win32" ? s.toLowerCase() : s;
    const project = this.deps.projects
      .list()
      .filter((p) => fold(full).startsWith(fold(p.root + sep)))
      .sort((a, b) => b.root.length - a.root.length)[0];
    if (!project)
      return { project: null, path: null, inScope: false, topics: [] };
    const path = relative(project.root, full).split(sep).join("/");
    const inScope = this.deps.files
      .list(project.id)
      .some((f) => f.path === path);
    const covering = new Set(this.deps.topics.coverage(project.id).get(path));
    const topics = this.deps.topics
      .list(project.id)
      .filter((t) => covering.has(t.id))
      .reverse()
      .map((t) => ({
        id: t.id,
        title: t.title,
        reason:
          this.deps.topics.files(t.id).find((f) => f.path === path)?.reason ??
          "",
      }));
    return {
      project: { id: project.id, name: project.name, root: project.root },
      path,
      inScope,
      topics,
    };
  }

  async source(id: string, path: string): Promise<SourceView> {
    const p = this.deps.projects.get(id);
    const file = this.deps.files.list(id).find((f) => f.path === path);
    if (!file) throw notFound("File not in project scope");
    const content = await safeRead(p.root, path);
    return { path, content, bytes: Buffer.byteLength(content) };
  }
}
