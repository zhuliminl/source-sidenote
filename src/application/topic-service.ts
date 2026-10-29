import type {
  DocumentView,
  Explanation,
  FileStatus,
  JobKind,
  PromptView,
  RunResult,
  TopicConfirm,
  TopicCreate,
  TopicReplan,
  ActiveModel,
  TopicFile,
  TopicSummary,
  TopicView,
} from "../shared/api.js";
import { parseReview, topicModel, type Topic } from "../domain/model.js";
import { badRequest, conflict, notFound } from "../domain/errors.js";
import { promptCatalog } from "../infrastructure/llm/prompts.js";
import { isFresh, snapshot, trySnapshot } from "./freshness.js";
import type { ProjectDeps, ProjectService } from "./project-service.js";

const MAX_CONFIRMED_FILES = 100;
const MAX_TEXT = 4000;

/**
 * Topics are the unit of work: the user describes what they want to understand,
 * the model proposes the files, the user confirms, then only those files are explained.
 */
export class TopicService {
  constructor(
    private deps: ProjectDeps,
    private projects: ProjectService,
  ) {}

  prompts(): PromptView[] {
    return promptCatalog(this.deps.config.get().maxFilesPerTopic);
  }

  async list(project: string): Promise<TopicSummary[]> {
    this.deps.projects.get(project);
    return Promise.all(
      this.deps.topics.list(project).map(async (t) => {
        const entries = await this.entries(t);
        return this.summary(t, entries);
      }),
    );
  }

  async get(id: string): Promise<TopicView> {
    const t = this.deps.topics.get(id);
    const entries = await this.entries(t);
    return {
      ...this.summary(t, entries),
      request: t.request,
      instructions: t.instructions,
      plan: t.plan,
      error: t.error,
      provider: t.provider,
      model: t.provider ? t.model : this.deps.config.get().model || null,
      entries,
      overview: t.overview ? JSON.parse(t.overview) : null,
    };
  }

  /** Creates the topic and asks the model to plan it; nothing is explained until confirm. */
  async create(project: string, input: TopicCreate): Promise<TopicView> {
    const request = input.request.trim();
    if (!request) throw badRequest("请描述你想了解的主题");
    if (
      request.length > MAX_TEXT ||
      (input.instructions ?? "").length > MAX_TEXT
    )
      throw badRequest("内容过长");
    // The topic keeps the model it was created with, even if the default changes later.
    const choice = this.requireModel(
      input.model ?? this.deps.config.settings().active,
    );
    await this.projects.rescan(project);
    const topic = this.deps.topics.create({
      project,
      title: request.split("\n")[0].slice(0, 40),
      request,
      instructions: (input.instructions ?? "").trim(),
      provider: choice.provider,
      model: choice.model,
    });
    this.deps.jobs.enqueue(project, topic.id, "", "plan");
    this.changed();
    return this.get(topic.id);
  }

  /** Runs planning again, e.g. after a failure or to get a different proposal. */
  async replan(id: string, input: TopicReplan = {}): Promise<TopicView> {
    const t = this.deps.topics.get(id);
    if (t.state === "confirmed") throw conflict("主题已确认，请删除后重新创建");
    const choice = this.requireModel(input.model ?? topicModel(t));
    await this.projects.rescan(t.project);
    this.deps.topics.update(id, {
      state: "planning",
      error: null,
      ...(input.model ? choice : {}),
      ...(input.instructions === undefined
        ? {}
        : { instructions: input.instructions.trim() }),
    });
    this.deps.jobs.enqueue(t.project, id, "", "plan");
    this.changed();
    return this.get(id);
  }

  /** The user's go-ahead: fixes the file list and queues one explanation per file. */
  async confirm(id: string, input: TopicConfirm): Promise<RunResult> {
    const t = this.deps.topics.get(id);
    if (t.state === "planning") throw conflict("主题仍在规划中");
    if ((input.instructions ?? "").length > MAX_TEXT)
      throw badRequest("内容过长");
    const choice = this.requireModel(input.model ?? topicModel(t));
    const { files } = await this.projects.rescan(t.project);
    const known = new Set(files.map((f) => f.path));
    const seen = new Set<string>();
    const chosen = input.files
      .filter((f) => known.has(f.path) && !seen.has(f.path) && seen.add(f.path))
      .map((f) => ({ path: f.path, reason: f.reason.slice(0, 500) }));
    if (!chosen.length) throw badRequest("请至少保留一个文件");
    if (chosen.length > MAX_CONFIRMED_FILES)
      throw badRequest(`单个主题最多 ${MAX_CONFIRMED_FILES} 个文件`);
    this.deps.topics.setFiles(id, chosen);
    this.deps.topics.update(id, {
      state: "confirmed",
      // Pinning the model also moves topics that followed the default onto an explicit choice.
      ...choice,
      overview: null,
      ...(input.instructions === undefined
        ? {}
        : { instructions: input.instructions.trim() }),
    });
    return this.queueOutdated(this.deps.topics.get(id));
  }

  /** Regenerates missing or outdated explanations of a confirmed topic. */
  async refresh(id: string): Promise<RunResult> {
    const t = this.deps.topics.get(id);
    if (t.state !== "confirmed") throw conflict("请先确认主题文件");
    this.requireModel(topicModel(t));
    await this.projects.rescan(t.project);
    return this.queueOutdated(t);
  }

  /** Forces one file of the topic to be regenerated, or reviewed. */
  async runFile(id: string, path: string, kind: JobKind): Promise<RunResult> {
    const t = this.deps.topics.get(id);
    if (t.state !== "confirmed") throw conflict("请先确认主题文件");
    if (kind !== "generate" && kind !== "review")
      throw badRequest("Unsupported job kind");
    if (!this.deps.topics.files(id).some((f) => f.path === path))
      throw notFound("File is not part of this topic");
    this.requireModel(topicModel(t));
    if (kind === "generate") this.deps.topics.update(id, { overview: null });
    const queued = this.deps.jobs.enqueue(t.project, id, path, kind);
    this.changed();
    return { queued, blocked: null };
  }

  remove(id: string) {
    this.deps.topics.get(id);
    this.deps.topics.remove(id);
    this.changed();
  }

  /** Empties a topic so it can be written again (by the model or an agent); files stay. */
  clear(id: string) {
    this.deps.topics.get(id);
    const cleared = this.deps.topics.clearContent(id);
    this.changed();
    return cleared;
  }

  /** Deletes every topic of every project, with what they generated. Projects stay. */
  removeAll() {
    const ids = this.deps.topics.ids();
    for (const id of ids) this.deps.topics.remove(id);
    this.changed();
    return { topics: ids.length };
  }

  async document(id: string, path: string): Promise<DocumentView> {
    const t = this.deps.topics.get(id);
    const d = this.deps.docs.get(id, path);
    if (!d) return { status: "missing", path, markdown: "" };
    const p = this.deps.projects.get(t.project);
    const s = await snapshot(p.root, this.deps.files.list(t.project), path);
    return {
      status: isFresh(d, s, this.modelOf(t)) ? "fresh" : "stale",
      path,
      markdown: d.markdown,
      explanation: JSON.parse(d.payload),
      model: d.model,
      generated: d.generated,
      review: parseReview(d.review),
    };
  }

  private async queueOutdated(t: Topic): Promise<RunResult> {
    const entries = await this.entries(t);
    let queued = 0;
    for (const e of entries)
      if (e.status === "missing" || e.status === "stale")
        queued += this.deps.jobs.enqueue(t.project, t.id, e.path, "generate");
    // Everything already fresh: the walkthrough may still be missing.
    if (!queued && !t.overview)
      queued += this.deps.jobs.enqueue(t.project, t.id, "", "overview");
    else if (queued) this.deps.topics.update(t.id, { overview: null });
    this.changed();
    return { queued, blocked: null };
  }

  private async entries(t: Topic): Promise<TopicFile[]> {
    const p = this.deps.projects.get(t.project);
    const files = this.deps.files.list(t.project);
    const docs = this.deps.docs.listByTopic(t.id);
    const model = this.modelOf(t);
    const topicFiles = this.deps.topics.files(t.id);
    const inTopic = new Set(topicFiles.map((f) => f.path));
    return Promise.all(
      topicFiles.map(async (f): Promise<TopicFile> => {
        const d = docs.get(f.path);
        let status: FileStatus = "missing";
        if (d) {
          const s = await trySnapshot(p.root, files, f.path);
          status = !s
            ? "unavailable"
            : isFresh(d, s, model)
              ? "fresh"
              : "stale";
        }
        const e = d ? (JSON.parse(d.payload) as Partial<Explanation>) : {};
        return {
          path: f.path,
          reason: f.reason,
          status,
          brief: e.brief ?? "",
          summary: e.summary ?? "",
          links: (e.relations ?? [])
            .map((r) => r.path)
            .filter((p) => p !== f.path && inTopic.has(p)),
        };
      }),
    );
  }

  private summary(t: Topic, entries: TopicFile[]): TopicSummary {
    return {
      id: t.id,
      project: t.project,
      title: t.title,
      state: t.state,
      files: entries.length,
      fresh: entries.filter((e) => e.status === "fresh").length,
      created: t.created,
    };
  }

  /** The model id explanations of this topic are compared against. */
  private modelOf(t: Topic) {
    return this.deps.config.get(topicModel(t)).model;
  }

  /** Resolves a choice (null: the default model) and refuses unusable ones. */
  private requireModel(choice: ActiveModel | null): ActiveModel {
    const settings = this.deps.config.settings();
    const pick = choice ?? settings.active;
    if (!pick || !this.deps.config.get(pick).model)
      throw badRequest(
        choice
          ? "所选模型已关闭或被删除，请换一个模型"
          : "请先在设置中配置模型",
      );
    return pick;
  }

  private changed() {
    this.deps.events.changed("topics");
    this.deps.events.changed("jobs");
  }
}
