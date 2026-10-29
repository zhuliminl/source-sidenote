// HTTP contract shared by the service, the CLI and the web app (type-only).

/**
 * plan: AI picks the files for a topic. generate: explain one file within a topic.
 * review: AI second opinion on one explanation. overview: stitch the topic's files into one walkthrough.
 */
export type JobKind = "plan" | "generate" | "review" | "overview";
export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";
export type DocumentStatus = "missing" | "fresh" | "stale";
export type FileStatus = DocumentStatus | "unavailable";

/**
 * planning → planned (waiting for the user to confirm the file list) → confirmed (explanations are generated).
 * plan_failed: the planning call failed; the user can retry or delete.
 */
export type TopicState = "planning" | "plan_failed" | "planned" | "confirmed";

export interface ProjectSummary {
  id: string;
  root: string;
  name: string;
  created: string;
  /** In-scope source files on disk. */
  total: number;
  /** Files explained by at least one topic. */
  covered: number;
  topics: number;
}

export interface FileEntry {
  path: string;
  bytes: number;
  /** Ids of the topics that explain this file. */
  topics: string[];
}

export interface Explanation {
  /** A few words naming what the file is for, shown when hovering it; empty in older explanations. */
  brief: string;
  summary: string;
  responsibilities: string[];
  flow: string[];
  relations: { path: string; description: string }[];
  caveats: string[];
  evidence: { start: number; end: number; explanation: string }[];
  /** Mermaid source (flowchart or sequence diagram) of the file's role in the topic; may be empty. */
  diagram: string;
}

export interface TopicStep {
  path: string;
  /** Short station name for the minimap, e.g. "HTTP 路由" or "Dubbo 接口". */
  label: string;
  description: string;
}

export interface TopicOverview {
  summary: string;
  steps: TopicStep[];
  caveats: string[];
  /** Mermaid source of the whole chain; may be empty. */
  diagram: string;
}

export interface Review {
  verdict: "pass" | "needs_changes";
  issues: string[];
  model: string;
  checked: string;
}

export interface TopicFile {
  path: string;
  /** Why the planner (or the user) included this file. */
  reason: string;
  status: FileStatus;
  /** Hover blurbs from the file's explanation; empty until it is generated. */
  brief: string;
  summary: string;
}

export interface TopicSummary {
  id: string;
  project: string;
  title: string;
  state: TopicState;
  files: number;
  fresh: number;
  created: string;
}

export interface TopicView extends TopicSummary {
  /** What the user wants to understand, in their words. */
  request: string;
  /** Extra instructions the user adds to every prompt of this topic. */
  instructions: string;
  /** Planner's one-paragraph take on the topic. */
  plan: string;
  error: string | null;
  model: string | null;
  /** Reading order. */
  entries: TopicFile[];
  overview: TopicOverview | null;
}

export interface TopicCreate {
  request: string;
  instructions?: string;
}

export interface TopicConfirm {
  files: { path: string; reason: string }[];
  instructions?: string;
}

/** Current on-disk text of an in-scope source file. */
export interface SourceView {
  path: string;
  content: string;
  bytes: number;
}

export type DocumentView =
  | { status: "missing"; path: string; markdown: "" }
  | {
      status: "fresh" | "stale";
      path: string;
      markdown: string;
      explanation: Explanation;
      model: string;
      generated: string;
      review: Review | null;
    };

export interface PromptView {
  id: "plan" | "explain" | "overview" | "review";
  title: string;
  /** When the prompt is used. */
  usage: string;
  system: string;
  /** What is sent alongside the system prompt as the user message. */
  inputs: string[];
}

export interface JobView {
  id: string;
  project: string;
  topic: string;
  topicTitle: string | null;
  path: string;
  kind: JobKind;
  state: JobState;
  attempts: number;
  error: string | null;
  created: string;
  updated: string | null;
}

/** Wire protocol of a model provider. */
export type ApiFormat = "openai-chat" | "anthropic-messages";

export interface ProviderModel {
  id: string;
  enabled: boolean;
}

export interface ProviderView {
  id: string;
  name: string;
  enabled: boolean;
  format: ApiFormat;
  baseUrl: string;
  hasApiKey: boolean;
  models: ProviderModel[];
}

/** The one model every job uses. */
export interface ActiveModel {
  provider: string;
  model: string;
}

export interface ConfigView {
  providers: ProviderView[];
  active: ActiveModel | null;
  /** The active model's id, or "" when it is missing or switched off. */
  model: string;
  concurrency: number;
  maxFilesPerTopic: number;
  timeoutMs: number;
}

export interface ConfigUpdate {
  active?: ActiveModel | null;
  concurrency?: number;
  maxFilesPerTopic?: number;
  timeoutMs?: number;
}

export interface ProviderInput {
  name?: string;
  enabled?: boolean;
  format?: ApiFormat;
  baseUrl?: string;
  /** Omit to keep the stored key; empty string clears it. */
  apiKey?: string;
  models?: ProviderModel[];
}

export interface ProviderCreated {
  id: string;
}

export interface ModelTest {
  ok: boolean;
  ms: number;
  error: string | null;
}

export interface ModelDiscovery {
  models: string[];
}

export interface RunResult {
  queued: number;
  /** Human-readable reason nothing could be queued (e.g. no model configured). */
  blocked: string | null;
}

export interface AddProjectResult {
  project: { id: string; root: string; name: string; created: string };
}

export interface StatusView {
  name: "source-sidenote";
  version: string;
  /** Whether the service can show the OS folder dialog (POST /api/pick-folder). */
  canPickFolder: boolean;
}

export interface PickFolderResult {
  /** Absolute path, or null when the user cancelled. */
  path: string | null;
}

export interface ApiError {
  error: string;
}
