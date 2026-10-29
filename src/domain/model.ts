import type { JobKind, JobState, Review, TopicState } from "../shared/api.js";

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
  /** Model that generated the explanations (set on confirm). */
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

export interface ModelConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  concurrency: number;
  maxFilesPerTopic: number;
  timeoutMs: number;
}

export const defaultConfig: ModelConfig = {
  baseUrl: "https://api.openai.com/v1",
  model: "",
  apiKey: "",
  concurrency: 2,
  maxFilesPerTopic: 15,
  timeoutMs: 60000,
};

export const configLimits = {
  concurrency: [1, 4],
  maxFilesPerTopic: [1, 60],
  timeoutMs: [1000, 180000],
} as const;

/** Bump when prompts or the explanation schema change; older docs become stale. */
export const PROMPT_VERSION = "topic-explanation-v1";

export const MAX_SOURCE_BYTES = 128 * 1024;

export function parseReview(value: string | null): Review | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Review;
  } catch {
    return null;
  }
}
