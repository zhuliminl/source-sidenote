import type {
  ActiveModel,
  StoryCreate,
  StoryStep,
  StoryView,
} from "../shared/api.js";
import { topicModel, type Story } from "../domain/model.js";
import { badRequest, conflict } from "../domain/errors.js";
import type { ProjectDeps } from "./project-service.js";

const MAX_QUESTION = 300;

/**
 * Stories: for one question, the model records a walk through the topic's files (which file,
 * which lines, what to notice), so the reader can replay it step by step.
 */
export class StoryService {
  constructor(private deps: ProjectDeps) {}

  list(topic: string): StoryView[] {
    this.deps.topics.get(topic);
    return this.deps.stories.list(topic).map(view);
  }

  create(topicId: string, input: StoryCreate): StoryView {
    const t = this.deps.topics.get(topicId);
    if (t.state !== "confirmed") throw conflict("请先确认主题文件");
    if (!this.deps.docs.listByTopic(t.id).size)
      throw conflict("主题的说明还没有生成，生成后再录制故事");
    const question = input.question.trim();
    if (!question) throw badRequest("请描述想跟着代码走一遍的问题");
    if (question.length > MAX_QUESTION) throw badRequest("问题过长");
    const choice = this.requireModel(input.model ?? topicModel(t));
    const story = this.deps.stories.create({
      topic: t.id,
      project: t.project,
      question,
      provider: choice.provider,
      model: choice.model,
    });
    this.deps.jobs.enqueue(t.project, t.id, story.id, "story");
    this.changed();
    return view(story);
  }

  /** Records the story again, e.g. after a failure or once the explanations changed. */
  retry(id: string, model?: ActiveModel): StoryView {
    const s = this.deps.stories.get(id);
    const choice = this.requireModel(model ?? topicModel(s));
    this.deps.stories.update(id, {
      state: "generating",
      error: null,
      ...choice,
    });
    this.deps.jobs.enqueue(s.project, s.topic, s.id, "story");
    this.changed();
    return view(this.deps.stories.get(id));
  }

  remove(id: string) {
    this.deps.stories.get(id);
    this.deps.stories.remove(id);
    this.changed();
  }

  /** Asks the model for story ideas by writing the walkthrough again (it suggests questions). */
  suggest(topicId: string) {
    const t = this.deps.topics.get(topicId);
    if (t.state !== "confirmed") throw conflict("请先确认主题文件");
    this.requireModel(topicModel(t));
    const queued = this.deps.jobs.enqueue(t.project, t.id, "", "overview");
    this.changed();
    return { queued, blocked: null };
  }

  private requireModel(choice: ActiveModel | null): ActiveModel {
    const pick = choice ?? this.deps.config.settings().active;
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

function view(s: Story): StoryView {
  return {
    id: s.id,
    topic: s.topic,
    question: s.question,
    title: s.title,
    state: s.state,
    error: s.error,
    provider: s.provider,
    model: s.model,
    steps: JSON.parse(s.steps || "[]") as StoryStep[],
    created: s.created,
  };
}
