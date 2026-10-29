import type {
  ActiveModel,
  ApiFormat,
  JobKind,
  JobState,
  ProviderModel,
  Review,
  TopicState,
} from "../shared/api.js";

export interface Project {
  id: string;
  root: string;
  name: string;
  created: string;
}

export interface SourceFile {
  path: string;
  hash: string;
  bytes: number;
}

export interface Topic {
  id: string;
  project: string;
  title: string;
  request: string;
  instructions: string;
  state: TopicState;
  plan: string;
  error: string | null;
  /** The model this topic runs with; null provider means "follow the default model" (topics from before per-topic models). */
  provider: string | null;
  model: string | null;
  overview: string | null;
  created: string;
}

export interface TopicFileRecord {
  topic: string;
  path: string;
  ord: number;
  reason: string;
}

/** A persisted explanation (one file within one topic) plus the fingerprints it was generated against. */
export interface DocRecord {
  topic: string;
  project: string;
  path: string;
  hash: string;
  context: string;
  version: string;
  model: string;
  markdown: string;
  payload: string;
  generated: string;
  review: string | null;
}

export interface Job {
  id: string;
  project: string;
  /** Empty for jobs that are not tied to a topic. */
  topic: string;
  path: string;
  kind: JobKind;
  state: JobState;
  attempts: number;
  error: string | null;
  created: string;
  updated: string | null;
}

export interface Provider {
  id: string;
  name: string;
  enabled: boolean;
  format: ApiFormat;
  baseUrl: string;
  apiKey: string;
  models: ProviderModel[];
}

/** What is stored in config.json. */
export interface Settings {
  providers: Provider[];
  active: ActiveModel | null;
  concurrency: number;
  maxFilesPerTopic: number;
  timeoutMs: number;
}

/** How to reach one model. */
export interface Connection {
  format: ApiFormat;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

/** The settings jobs run with: the active model resolved to a connection. */
export type ModelConfig = Connection &
  Pick<Settings, "concurrency" | "maxFilesPerTopic">;

export const defaultSettings: Settings = {
  providers: [],
  active: null,
  concurrency: 2,
  maxFilesPerTopic: 15,
  timeoutMs: 60000,
};

export function connectionOf(
  p: Provider,
  model: string,
  timeoutMs: number,
): Connection {
  return {
    format: p.format,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    model,
    timeoutMs,
  };
}

export function topicModel(
  t: Pick<Topic, "provider" | "model">,
): ActiveModel | null {
  return t.provider && t.model
    ? { provider: t.provider, model: t.model }
    : null;
}

/** Resolves a model choice (default: the default model); a missing or switched-off one leaves model "". */
export function resolveModel(
  s: Settings,
  choice: ActiveModel | null = s.active,
): ModelConfig {
  const pick = choice ?? s.active;
  const p = s.providers.find((p) => p.id === pick?.provider);
  const usable =
    p?.enabled && p.models.some((m) => m.id === pick!.model && m.enabled);
  return {
    ...(p
      ? connectionOf(p, usable ? pick!.model : "", s.timeoutMs)
      : {
          format: "openai-chat",
          baseUrl: "",
          apiKey: "",
          model: "",
          timeoutMs: s.timeoutMs,
        }),
    concurrency: s.concurrency,
    maxFilesPerTopic: s.maxFilesPerTopic,
  };
}

export const configLimits = {
  concurrency: [1, 4],
  maxFilesPerTopic: [1, 60],
  timeoutMs: [1000, 180000],
} as const;

/** Bump when prompts or the explanation schema change; older docs become stale. */
export const PROMPT_VERSION = "topic-explanation-v2";

export const MAX_SOURCE_BYTES = 128 * 1024;

export function parseReview(value: string | null): Review | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Review;
  } catch {
    return null;
  }
}
