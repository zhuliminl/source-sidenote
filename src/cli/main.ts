#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { dataDir } from "../infrastructure/paths.js";
import { createServer } from "../transport/server.js";
const home = dataDir();
async function connection() {
  try {
    return {
      ...JSON.parse(readFileSync(join(home, "connection.json"), "utf8")),
      token: readFileSync(join(home, "token"), "utf8").trim(),
    };
  } catch {
    throw new Error("服务未启动，请先运行 sidenote start");
  }
}
async function api(path: string, body?: unknown) {
  const c = await connection();
  const res = await fetch(c.url + "/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${c.token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function open(url: string) {
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
async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "start") {
    try {
      await api("status");
      const c = await connection();
      console.log(`服务已运行：${c.url}`);
      if (!args.includes("--no-open")) open(c.url + "/#" + c.token);
      return;
    } catch {}
    const i = args.indexOf("--port");
    const port = i < 0 ? 47831 : Number(args[i + 1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid port");
    const s = await createServer(home, port);
    console.log(
      `Source Sidenote 已启动：${s.url}\n使用 sidenote ui 打开已认证管理页。按 Ctrl-C 停止服务。`,
    );
    if (!args.includes("--no-open")) open(s.url + "/#" + s.token);
    for (const sig of ["SIGINT", "SIGTERM"] as const)
      process.on(sig, () => void s.app.close());
  } else if (command === "ui") {
    const c = await connection();
    open(c.url + "/#" + c.token);
  } else if (command === "add")
    console.log(
      JSON.stringify(
        await api("projects", { root: args[0] || process.cwd() }),
        null,
        2,
      ),
    );
  else if (command === "status" || command === "doctor")
    console.log(JSON.stringify(await api("status"), null, 2));
  else if (command === "stop") console.log(await api("stop", {}));
  else if (command === "projects")
    console.log(JSON.stringify(await api("projects"), null, 2));
  else if (command === "explain") {
    const path = args[0];
    if (!path) throw new Error("Usage: sidenote explain /absolute/file");
    const { resolve, relative, sep } = await import("node:path");
    const full = resolve(path);
    const projects = await api("projects");
    const p = projects
      .filter((p: any) => full.startsWith(p.root + sep))
      .sort((a: any, b: any) => b.root.length - a.root.length)[0];
    if (!p) throw new Error("请先在项目根目录执行 sidenote add");
    const rel = relative(p.root, full).split(sep).join("/");
    if (args.includes("--refresh")) {
      const r = await api(`projects/${p.id}/run`, { path: rel });
      if (r.blocked) throw new Error(r.blocked);
    }
    let d = await api(
      `projects/${p.id}/document?path=${encodeURIComponent(rel)}`,
    );
    if (d.status === "missing") {
      const r = await api(`projects/${p.id}/run`, { path: rel });
      if (r.blocked) throw new Error(r.blocked);
    }
    if (
      args.includes("--wait") &&
      (d.status === "missing" || args.includes("--refresh"))
    ) {
      const previous = d.generated;
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 700));
        d = await api(
          `projects/${p.id}/document?path=${encodeURIComponent(rel)}`,
        );
        if (
          d.status === "fresh" &&
          (!args.includes("--refresh") || d.generated !== previous)
        )
          break;
        const jobs = await api("jobs");
        const latest = jobs.find(
          (j: any) =>
            j.project === p.id && j.path === rel && j.kind === "generate",
        );
        if (latest && ["failed", "cancelled"].includes(latest.state))
          throw new Error(latest.error || "生成已取消");
      }
      if (
        d.status === "missing" ||
        (args.includes("--refresh") && d.generated === previous)
      )
        throw new Error("等待生成超时，请在管理页查看任务");
    }
    console.log(JSON.stringify(d));
  } else
    console.log(
      "Source Sidenote\n  start [--no-open] [--port 47831]\n  ui | status | stop | projects\n  add [project-directory]\n  explain /absolute/file [--refresh] [--wait]\n\nSIDENOTE_HOME 可覆盖全局数据目录。",
    );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
