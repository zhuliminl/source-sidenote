import type {
  AgentExplanationSubmit,
  AgentOverviewSubmit,
  AgentStorySubmit,
  AgentTopicCreate,
  StoryView,
  TopicView,
} from "../shared/api.js";
import {
  keepKnownRelations,
  renderMarkdown,
  validateExplanation,
  validateOverview,
  validateStory,
} from "../domain/explanation.js";
import { AGENT_PREFIX, PROMPT_VERSION } from "../domain/model.js";
import { badRequest, conflict, notFound } from "../domain/errors.js";
import { agentGuide } from "../infrastructure/llm/prompts.js";
import { snapshot } from "./freshness.js";
import type { ProjectDeps, ProjectService } from "./project-service.js";
import type { TopicService } from "./topic-service.js";
import type { StoryService } from "./story-service.js";

const MAX_FILES = 100;

/** "agent:<client>", from the MCP client's name (e.g. claude-code, codex). */
const authorOf = (name: string | undefined) =>
  AGENT_PREFIX +
  ((name ?? "")
    .trim()
    .replace(/[^\w.\-]+/g, "-")
    .slice(0, 40) || "agent");

/**
 * Writes that come from coding agents (through the MCP server) instead of the job queue. They get
 * the same validation as model output — real paths, line ranges inside the file — and are
 * attributed to the agent, so readers can tell who wrote what.
 */
export class AgentService {
  constructor(
    private deps: ProjectDeps,
    private projects: ProjectService,
    private topics: TopicService,
    private stories: StoryService,
  ) {}

  guide() {
    return { guide: agentGuide() };
  }

  /** A topic whose files the agent chose itself: confirmed at once, nothing is queued. */
  async createTopic(
    project: string,
    input: AgentTopicCreate,
  ): Promise<TopicView> {
    const request = input.request.trim();
    if (!request) throw badRequest("请描述主题");
    const { files } = await this.projects.rescan(project);
    const known = new Set(files.map((f) => f.path));
    const seen = new Set<string>();
    const chosen = input.files
      .filter((f) => known.has(f.path) && !seen.has(f.path) && seen.add(f.path))
      .slice(0, MAX_FILES)
      .map((f) => ({ path: f.path, reason: f.reason.slice(0, 500) }));
    if (!chosen.length)
      throw badRequest("文件都不在项目的扫描范围内；路径应相对于项目根目录");
    const topic = this.deps.topics.create({
      project,
      title: (input.title?.trim() || request.split("\n")[0]).slice(0, 40),
      request,
      instructions: (input.instructions ?? "").trim(),
      provider: null,
      model: null,
    });
    this.deps.topics.setFiles(topic.id, chosen);
    this.deps.topics.update(topic.id, {
      state: "confirmed",
      plan: `由 ${authorOf(input.author).slice(AGENT_PREFIX.length)} 挑选文件`,
    });
    this.changed();
    return this.topics.get(topic.id);
  }

  async submitExplanation(topicId: string, input: AgentExplanationSubmit) {
    const t = this.confirmed(topicId);
    if (!this.deps.topics.files(t.id).some((f) => f.path === input.path))
      throw notFound("这个文件不在主题里");
    const p = this.deps.projects.get(t.project);
    const manifest = this.deps.files.list(t.project);
    const s = await snapshot(p.root, manifest, input.path);
    let e;
    try {
      e = keepKnownRelations(
        validateExplanation(input.explanation, s.source.split("\n").length),
        new Set(manifest.map((f) => f.path)),
      );
    } catch (err) {
      throw badRequest(`说明不合格：${(err as Error).message}`);
    }
    this.deps.docs.save({
      topic: t.id,
      project: t.project,
      path: input.path,
      hash: s.hash,
      context: s.deps.fingerprint,
      version: PROMPT_VERSION,
      model: authorOf(input.author),
      markdown: renderMarkdown(e, input.path),
      payload: JSON.stringify(e),
      generated: new Date().toISOString(),
    });
    this.changed();
    return { saved: input.path, evidence: e.evidence.length };
  }

  submitOverview(topicId: string, input: AgentOverviewSubmit) {
    const t = this.confirmed(topicId);
    const paths = new Set(this.deps.topics.files(t.id).map((f) => f.path));
    let overview;
    try {
      overview = validateOverview(input.overview, paths);
    } catch (err) {
      throw badRequest(`导读不合格：${(err as Error).message}`);
    }
    this.deps.topics.update(t.id, { overview: JSON.stringify(overview) });
    this.changed();
    return { saved: true, steps: overview.steps.length };
  }

  async submitStory(
    topicId: string,
    input: AgentStorySubmit,
  ): Promise<StoryView> {
    const t = this.confirmed(topicId);
    const question = input.question.trim();
    if (!question) throw badRequest("请写出这个故事回答的问题");
    const p = this.deps.projects.get(t.project);
    const manifest = this.deps.files.list(t.project);
    const lineCounts = new Map<string, number>();
    for (const f of this.deps.topics.files(t.id)) {
      const s = await snapshot(p.root, manifest, f.path).catch(() => null);
      if (s) lineCounts.set(f.path, s.source.split("\n").length);
    }
    let recorded;
    try {
      recorded = validateStory(
        { title: input.title, steps: input.steps },
        lineCounts,
      );
    } catch (err) {
      throw badRequest(`故事不合格：${(err as Error).message}`);
    }
    const story = this.deps.stories.create({
      topic: t.id,
      project: t.project,
      question,
      provider: null,
      model: authorOf(input.author),
    });
    this.deps.stories.update(story.id, {
      state: "ready",
      title: recorded.title || question.slice(0, 40),
      steps: JSON.stringify(recorded.steps),
    });
    this.changed();
    return this.stories.list(t.id).find((s) => s.id === story.id)!;
  }

  private confirmed(topicId: string) {
    const t = this.deps.topics.get(topicId);
    if (t.state !== "confirmed") throw conflict("主题还没有确认文件清单");
    return t;
  }

  private changed() {
    this.deps.events.changed("topics");
  }
}
