import type {
  AddProjectResult,
  ConfigUpdate,
  ConfigView,
  ModelDiscovery,
  ModelTest,
  ProviderCreated,
  ProviderInput,
  DocumentView,
  FileEntry,
  JobView,
  PickFolderResult,
  ProjectSummary,
  PromptView,
  RunResult,
  SourceView,
  StatusView,
  TopicConfirm,
  TopicReplan,
  TopicCreate,
  TopicSummary,
  TopicView,
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
  pickFolder: () => request<PickFolderResult>("POST", "pick-folder", {}),
  config: () => request<ConfigView>("GET", "config"),
  saveConfig: (c: ConfigUpdate) => request<{ ok: true }>("PUT", "config", c),
  createProvider: (p: ProviderInput) =>
    request<ProviderCreated>("POST", "providers", p),
  updateProvider: (provider: string, p: ProviderInput) =>
    request<{ ok: true }>("PUT", `providers/${id(provider)}`, p),
  removeProvider: (provider: string) =>
    request<{ ok: true }>("DELETE", `providers/${id(provider)}`),
  testModel: (provider: string, model: string) =>
    request<ModelTest>("POST", `providers/${id(provider)}/test`, { model }),
  discoverModels: (provider: string) =>
    request<ModelDiscovery>("POST", `providers/${id(provider)}/discover`, {}),
  projects: () => request<ProjectSummary[]>("GET", "projects"),
  addProject: (root: string) =>
    request<AddProjectResult>("POST", "projects", { root }),
  removeProject: (project: string) =>
    request<{ ok: true }>("DELETE", `projects/${id(project)}`),
  rescan: (project: string) =>
    request<{ ok: true }>("POST", `projects/${id(project)}/refresh`, {}),
  files: (project: string) =>
    request<FileEntry[]>("GET", `projects/${id(project)}/files`),
  source: (project: string, path: string) =>
    request<SourceView>(
      "GET",
      `projects/${id(project)}/source?path=${id(path)}`,
    ),
  prompts: () => request<PromptView[]>("GET", "prompts"),
  topics: (project: string) =>
    request<TopicSummary[]>("GET", `projects/${id(project)}/topics`),
  createTopic: (project: string, body: TopicCreate) =>
    request<TopicView>("POST", `projects/${id(project)}/topics`, body),
  topic: (topic: string) => request<TopicView>("GET", `topics/${id(topic)}`),
  removeTopic: (topic: string) =>
    request<{ ok: true }>("DELETE", `topics/${id(topic)}`),
  replan: (topic: string, body: TopicReplan) =>
    request<TopicView>("POST", `topics/${id(topic)}/plan`, body),
  confirmTopic: (topic: string, body: TopicConfirm) =>
    request<RunResult>("POST", `topics/${id(topic)}/confirm`, body),
  refreshTopic: (topic: string) =>
    request<RunResult>("POST", `topics/${id(topic)}/refresh`, {}),
  runFile: (topic: string, path: string, kind: "generate" | "review") =>
    request<RunResult>("POST", `topics/${id(topic)}/run`, { path, kind }),
  document: (topic: string, path: string) =>
    request<DocumentView>(
      "GET",
      `topics/${id(topic)}/document?path=${id(path)}`,
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
