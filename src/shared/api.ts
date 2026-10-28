// HTTP contract shared by the service, the CLI and the web app (type-only).

export type JobKind = "generate" | "review";
export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";
export type DocumentStatus = "missing" | "fresh" | "stale";
export type FileStatus = DocumentStatus | "unavailable";

export interface ProjectSummary {
  id: string;
  root: string;
  name: string;
  created: string;
  total: number;
  covered: number;
  fresh: number;
  reviewed: number;
  /** Some sources could not be read from disk (moved, deleted, permissions). */
  unavailable: boolean;
}

export interface FileEntry {
  path: string;
  bytes: number;
  status: FileStatus;
}

export interface Explanation {
  summary: string;
  responsibilities: string[];
  flow: string[];
  relations: { path: string; description: string }[];
  caveats: string[];
  evidence: { start: number; end: number; explanation: string }[];
}

export interface Review {
  verdict: "pass" | "needs_changes";
  issues: string[];
  model: string;
  checked: string;
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

export interface JobView {
  id: string;
  project: string;
  path: string;
  kind: JobKind;
  state: JobState;
  attempts: number;
  error: string | null;
  created: string;
  updated: string | null;
}

export interface ConfigView {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  concurrency: number;
  maxFilesPerRun: number;
  timeoutMs: number;
}

export interface ConfigUpdate {
  baseUrl: string;
  model: string;
  /** Omit to keep the stored key; empty string clears it. */
  apiKey?: string;
  concurrency?: number;
  maxFilesPerRun?: number;
  timeoutMs?: number;
}

export interface RunResult {
  queued: number;
  /** Human-readable reason nothing could be queued (e.g. no model configured). */
  blocked: string | null;
}

export interface AddProjectResult extends RunResult {
  project: { id: string; root: string; name: string; created: string };
}

export interface StatusView {
  name: "source-sidenote";
  version: string;
}

export interface ApiError {
  error: string;
}
