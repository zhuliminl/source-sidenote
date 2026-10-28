import type {
  AddProjectResult,
  ConfigUpdate,
  ConfigView,
  DocumentView,
  FileEntry,
  JobKind,
  JobView,
  ProjectSummary,
  RunResult,
  StatusView,
} from "@shared/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  return data as T;
}

const id = encodeURIComponent;

export const api = {
  status: () => request<StatusView>("GET", "status"),
  config: () => request<ConfigView>("GET", "config"),
  saveConfig: (c: ConfigUpdate) => request<{ ok: true }>("PUT", "config", c),
  projects: () => request<ProjectSummary[]>("GET", "projects"),
  addProject: (root: string) =>
    request<AddProjectResult>("POST", "projects", { root }),
  removeProject: (project: string) =>
    request<{ ok: true }>("DELETE", `projects/${id(project)}`),
  rescan: (project: string) =>
    request<{ ok: true }>("POST", `projects/${id(project)}/refresh`, {}),
  run: (project: string, kind: JobKind, path?: string) =>
    request<RunResult>("POST", `projects/${id(project)}/run`, { kind, path }),
  files: (project: string) =>
    request<FileEntry[]>("GET", `projects/${id(project)}/files`),
  document: (project: string, path: string) =>
    request<DocumentView>(
      "GET",
      `projects/${id(project)}/document?path=${id(path)}`,
    ),
  jobs: () => request<JobView[]>("GET", "jobs"),
  cancelJob: (job: string) =>
    request<{ ok: true }>("POST", `jobs/${id(job)}/cancel`, {}),
};

/** Opens the SSE stream via fetch so it can be aborted and parsed incrementally. */
export async function subscribe(
  onTopic: (topic: string) => void,
  signal: AbortSignal,
) {
  const res = await fetch("/api/events", { signal });
  if (!res.ok || !res.body) throw new ApiError(res.status, "事件流不可用");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const data = event
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6);
      if (data) onTopic(JSON.parse(data).topic);
    }
  }
}
