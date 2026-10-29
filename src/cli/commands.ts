import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type {
  AddProjectResult,
  DocumentView,
  FileEntry,
  ProjectSummary,
  StatusView,
  TopicSummary,
} from "../shared/api.js";
import { createServer, DEFAULT_PORT } from "../transport/http/server.js";
import { ApiClient } from "./client.js";
import { serveMcp } from "./mcp.js";

export interface CommandContext {
  home: string;
  api: ApiClient;
  args: string[];
  flags: { open: boolean; port?: string; topic?: string };
}

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

function openBrowser(url: string) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  const child = spawn(command as string, args as string[], {
    stdio: "ignore",
    detached: true,
  });
  child.on("error", () => {});
  child.unref();
}

async function start({ api, home, flags }: CommandContext) {
  try {
    await api.get<StatusView>("status");
    const c = api.connection;
    console.log(`服务已运行：${c.url}`);
    if (flags.open) openBrowser(c.url);
    return;
  } catch {}
  const port = flags.port === undefined ? DEFAULT_PORT : Number(flags.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid port");
  const s = await createServer(home, port);
  console.log(`Source Sidenote 已启动：${s.url}\n按 Ctrl-C 停止服务。`);
  if (flags.open) openBrowser(s.url);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => void s.app.close());
}

/** Finds the registered project containing `file` and its project-relative path. */
async function locate(api: ApiClient, file: string) {
  // Project roots are stored as realpaths (e.g. /private/tmp on macOS).
  const full = await realpath(resolve(file)).catch(() => resolve(file));
  const project = (await api.get<ProjectSummary[]>("projects"))
    .filter((p) => full.startsWith(p.root + sep))
    .sort((a, b) => b.root.length - a.root.length)[0];
  if (!project) throw new Error("请先在项目根目录执行 sidenote add");
  return { project, rel: relative(project.root, full).split(sep).join("/") };
}

/**
 * Prints the explanation of a file within one topic (newest by default) as a single JSON line
 * for editor adapters. Explanations are only created from topics in the web app.
 */
async function explain({ api, args, flags }: CommandContext) {
  if (!args[0])
    throw new Error("Usage: sidenote explain /absolute/file [--topic id]");
  const { project, rel } = await locate(api, args[0]);
  const entry = (
    await api.get<FileEntry[]>(`projects/${project.id}/files`)
  ).find((f) => f.path === rel);
  const titles = new Map(
    (await api.get<TopicSummary[]>(`projects/${project.id}/topics`)).map(
      (t) => [t.id, t.title],
    ),
  );
  const topics = (entry?.topics ?? []).map((id) => ({
    id,
    title: titles.get(id) ?? id,
  }));
  const topic = flags.topic
    ? topics.find((t) => t.id === flags.topic)
    : topics.at(-1);
  if (flags.topic && !topic) throw new Error("该文件不在指定主题中");
  const doc: DocumentView = topic
    ? await api.get<DocumentView>(
        `topics/${topic.id}/document?path=${encodeURIComponent(rel)}`,
      )
    : { status: "missing", path: rel, markdown: "" };
  // Single-line JSON: consumed by editor adapters.
  console.log(
    JSON.stringify({
      ...doc,
      topic: topic ?? null,
      topics,
      url: `${api.connection.url}/projects/${project.id}`,
    }),
  );
}

export const usage = `Source Sidenote
  start [--no-open] [--port ${DEFAULT_PORT}]
  ui | status | stop | projects
  add [project-directory]
  explain /absolute/file [--topic id]
  mcp      MCP 服务器（stdio），供 Claude Code、Codex 等 Agent 读写主题

SIDENOTE_HOME 可覆盖全局数据目录。`;

export const commands: Record<string, (ctx: CommandContext) => Promise<void>> =
  {
    start,
    ui: async ({ api }) => {
      openBrowser(api.connection.url);
    },
    status: async ({ api }) => print(await api.get<StatusView>("status")),
    stop: async ({ api }) => print(await api.post("stop")),
    projects: async ({ api }) =>
      print(await api.get<ProjectSummary[]>("projects")),
    add: async ({ api, args }) =>
      print(
        await api.post<AddProjectResult>("projects", {
          root: args[0] || process.cwd(),
        }),
      ),
    explain,
    mcp: ({ api }) => serveMcp(api),
  };
commands.doctor = commands.status;
