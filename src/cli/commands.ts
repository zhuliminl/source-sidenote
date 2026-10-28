import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type {
  AddProjectResult,
  DocumentView,
  JobView,
  ProjectSummary,
  RunResult,
  StatusView,
} from "../shared/api.js";
import { createServer, DEFAULT_PORT } from "../transport/http/server.js";
import { ApiClient } from "./client.js";

export interface CommandContext {
  home: string;
  api: ApiClient;
  args: string[];
  flags: { open: boolean; port?: string; refresh: boolean; wait: boolean };
}

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function explain({ api, args, flags }: CommandContext) {
  if (!args[0]) throw new Error("Usage: sidenote explain /absolute/file");
  const { project, rel } = await locate(api, args[0]);
  const documentPath = `projects/${project.id}/document?path=${encodeURIComponent(rel)}`;
  const queue = async () => {
    const r = await api.post<RunResult>(`projects/${project.id}/run`, {
      path: rel,
    });
    if (r.blocked) throw new Error(r.blocked);
  };
  if (flags.refresh) await queue();
  let doc = await api.get<DocumentView>(documentPath);
  if (doc.status === "missing" && !flags.refresh) await queue();
  const waiting = flags.wait && (doc.status === "missing" || flags.refresh);
  if (waiting) {
    const previous = doc.status === "missing" ? undefined : doc.generated;
    const done = (d: DocumentView) =>
      d.status === "fresh" && (!flags.refresh || d.generated !== previous);
    const deadline = Date.now() + 180000;
    while (!done(doc)) {
      if (Date.now() > deadline)
        throw new Error("等待生成超时，请在管理页查看任务");
      await sleep(700);
      doc = await api.get<DocumentView>(documentPath);
      const latest = (await api.get<JobView[]>("jobs")).find(
        (j) =>
          j.project === project.id && j.path === rel && j.kind === "generate",
      );
      if (
        !done(doc) &&
        latest &&
        ["failed", "cancelled"].includes(latest.state)
      )
        throw new Error(latest.error || "生成已取消");
    }
  }
  // Single-line JSON: consumed by editor adapters.
  console.log(JSON.stringify(doc));
}

export const usage = `Source Sidenote
  start [--no-open] [--port ${DEFAULT_PORT}]
  ui | status | stop | projects
  add [project-directory]
  explain /absolute/file [--refresh] [--wait]

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
  };
commands.doctor = commands.status;
