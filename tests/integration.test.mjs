import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as httpServer } from "node:http";
import { createServer } from "../dist/transport/http/server.js";
import { scan } from "../dist/infrastructure/source/scanner.js";
import { safeRead } from "../dist/infrastructure/source/files.js";
import { dependencyContext } from "../dist/infrastructure/source/context.js";
import { validateExplanation } from "../dist/domain/explanation.js";
const explanation = {
  summary: "导出示例函数。",
  responsibilities: ["返回固定值"],
  flow: ["调用函数", "返回值"],
  relations: [],
  caveats: [],
  evidence: [{ start: 1, end: 1, explanation: "函数定义" }],
};
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Timed out");
}
test("scanner excludes dependencies, secrets, ignored files and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidenote-scan-"));
  try {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "src/a.ts"), "export const a=1");
    await writeFile(join(root, ".env"), "SECRET=x");
    await writeFile(join(root, "node_modules/x.js"), "secret");
    await writeFile(join(root, "src/hidden.ts"), "secret");
    await writeFile(join(root, "src/.gitignore"), "hidden.ts\n");
    if (process.platform !== "win32")
      await symlink("/etc/passwd", join(root, "password.ts"));
    assert.deepEqual(
      (await scan(root)).map((f) => f.path),
      ["src/a.ts"],
    );
    if (process.platform !== "win32")
      await assert.rejects(safeRead(root, "password.ts"), /outside/);
    await assert.rejects(safeRead(root, "../../etc/passwd"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("HTTP origin checks, generation, cache, stale detection, review, cancellation and restart", async () => {
  const home = await mkdtemp(join(tmpdir(), "sidenote-home-"));
  const root = await mkdtemp(join(tmpdir(), "sidenote-project-"));
  let calls = 0;
  let delay = 0;
  let server;
  const mock = httpServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    calls++;
    const body = JSON.parse(text);
    await new Promise((r) => setTimeout(r, delay));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(
                body.messages[0].content.includes("复查")
                  ? { verdict: "pass", issues: [] }
                  : explanation,
              ),
            },
          },
        ],
      }),
    );
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  try {
    await writeFile(join(root, "hello.ts"), "export const hello = () => 1;\n");
    server = await createServer(home, 0);
    const api = async (path, body, method) => {
      const r = await fetch(server.url + "/api/" + path, {
        method: method || (body ? "POST" : "GET"),
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const value = await r.json();
      assert.equal(r.status, 200, JSON.stringify(value));
      return value;
    };
    assert.equal((await fetch(server.url + "/api/config")).status, 200);
    assert.equal(
      (
        await fetch(server.url + "/api/config", {
          headers: { Origin: "https://evil.test" },
        })
      ).status,
      403,
    );
    await api(
      "config",
      {
        baseUrl: `http://127.0.0.1:${mock.address().port}/v1`,
        model: "fixture",
        apiKey: "never-echo-this",
        concurrency: 1,
      },
      "PUT",
    );
    assert.ok(!JSON.stringify(await api("config")).includes("never-echo-this"));
    const raw = (path, init) =>
      fetch(server.url + "/api/" + path, {
        ...init,
        headers: { "Content-Type": "application/json" },
      });
    assert.equal((await raw("projects/nope/files")).status, 404);
    const insecure = await raw("config", {
      method: "PUT",
      body: JSON.stringify({ baseUrl: "http://example.com/v1", model: "x" }),
    });
    assert.equal(insecure.status, 400);
    assert.match((await insecure.json()).error, /HTTPS/);
    const added = await api("projects", { root });
    assert.equal(added.queued, 1);
    const id = added.project.id;
    await until(async () =>
      (await api("jobs")).some((j) => j.state === "done"),
    );
    assert.equal((await api("projects"))[0].covered, 1);
    assert.equal(
      (await api(`projects/${id}/document?path=hello.ts`)).status,
      "fresh",
    );
    assert.equal((await api("projects", { root })).queued, 0);
    assert.equal(calls, 1);
    await api(`projects/${id}/run`, { kind: "review" });
    await until(async () => (await api("projects"))[0].reviewed === 1);
    await writeFile(join(root, "hello.ts"), "export const hello = () => 2;\n");
    assert.equal(
      (await api(`projects/${id}/document?path=hello.ts`)).status,
      "stale",
    );
    delay = 250;
    const before = calls;
    await api("projects", { root });
    // Wait for the model request, not just state=running: the source snapshot is taken after that.
    await until(async () => calls > before);
    await writeFile(join(root, "hello.ts"), "export const hello = () => 3;\n");
    await until(async () =>
      (await api("jobs")).some((j) => j.state === "failed"),
    );
    assert.equal(
      (await api(`projects/${id}/document?path=hello.ts`)).status,
      "stale",
    );
    delay = 1000;
    await api("projects", { root });
    await until(async () =>
      (await api("jobs")).some((j) => j.state === "running"),
    );
    const running = (await api("jobs")).find((j) => j.state === "running");
    await api(`jobs/${running.id}/cancel`, {});
    await until(async () =>
      (await api("jobs")).some(
        (j) => j.id === running.id && j.state === "cancelled",
      ),
    );
    await server.app.close();
    server = await createServer(home, 0);
    delay = 0;
    await api("projects", { root });
    await until(
      async () =>
        (await api(`projects/${id}/document?path=hello.ts`)).status === "fresh",
    );
    assert.equal((await api("projects"))[0].covered, 1);
    const files = await api(`projects/${id}/files`);
    assert.deepEqual(files, [
      { path: "hello.ts", bytes: files[0].bytes, status: "fresh" },
    ]);
    await api(`projects/${id}`, undefined, "DELETE");
    assert.deepEqual(await api("projects"), []);
  } finally {
    if (server) await server.app.close();
    mock.closeAllConnections();
    await new Promise((r) => mock.close(r));
    await rm(home, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
test("dependency context changes invalidate explanation fingerprints", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidenote-deps-"));
  try {
    const src = "import { a } from './a';\nexport const b = a;";
    await writeFile(join(root, "b.ts"), src);
    await writeFile(join(root, "a.ts"), "export const a=1");
    let files = await scan(root);
    const first = (await dependencyContext(root, files, "b.ts", src))
      .fingerprint;
    await writeFile(join(root, "a.ts"), "export const a=2");
    files = await scan(root);
    const second = (await dependencyContext(root, files, "b.ts", src))
      .fingerprint;
    assert.notEqual(second, first);
    await writeFile(join(root, "unrelated.ts"), "export const c=3");
    await writeFile(join(root, "README.md"), "# changed");
    files = await scan(root);
    assert.equal(
      (await dependencyContext(root, files, "b.ts", src)).fingerprint,
      second,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("non UTF-8 sources are skipped instead of hashed inconsistently", async () => {
  const root = await mkdtemp(join(tmpdir(), "sidenote-enc-"));
  try {
    await writeFile(join(root, "ok.java"), "class Ok {}");
    // "中文" in GBK
    await writeFile(
      join(root, "gbk.java"),
      Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
    );
    assert.deepEqual(
      (await scan(root)).map((f) => f.path),
      ["ok.java"],
    );
    await assert.rejects(safeRead(root, "gbk.java"), /UTF-8/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("requests with a foreign Host or Origin are rejected without any login", async () => {
  const { request } = await import("node:http");
  const home = await mkdtemp(join(tmpdir(), "sidenote-origin-"));
  const server = await createServer(home, 0);
  const status = (headers) =>
    new Promise((resolve, reject) =>
      request(server.url + "/api/projects", { headers }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
        .on("error", reject)
        .end(),
    );
  try {
    const port = new URL(server.url).port;
    assert.equal(await status({}), 200);
    // DNS rebinding: an attacker domain resolving to 127.0.0.1.
    assert.equal(await status({ Host: `evil.test:${port}` }), 403);
    assert.equal(await status({ Host: `localhost:${port}` }), 403);
    // Cross-site request from a web page.
    assert.equal(await status({ Origin: "https://evil.test" }), 403);
  } finally {
    await server.app.close();
    await rm(home, { recursive: true, force: true });
  }
});
test("single instance lock prevents duplicate service using same database", async () => {
  const home = await mkdtemp(join(tmpdir(), "sidenote-lock-"));
  const server = await createServer(home, 0);
  try {
    await assert.rejects(createServer(home, 0), /已经运行/);
  } finally {
    await server.app.close();
    await rm(home, { recursive: true, force: true });
  }
});
test("unfinished jobs recover and SSE connections do not block shutdown", async () => {
  const home = await mkdtemp(join(tmpdir(), "sidenote-resume-"));
  let server = await createServer(home, 0);
  try {
    const p = server.container.projects.register("/fixture", "fixture");
    server.container.jobs.enqueue(p.id, "a.ts");
    server.container.db.exec("UPDATE jobs SET state='running'");
    const response = await fetch(server.url + "/api/events");
    const reader = response.body.getReader();
    await reader.read();
    await server.app.close();
    server = await createServer(home, 0);
    assert.equal(server.container.jobs.recent()[0].state, "queued");
    await reader.cancel();
  } finally {
    await server.app.close();
    await rm(home, { recursive: true, force: true });
  }
});
test("invalid model evidence is rejected rather than counted as covered", async () => {
  assert.throws(
    () =>
      validateExplanation(
        {
          ...explanation,
          evidence: [{ start: 1, end: 999, explanation: "invented" }],
        },
        2,
      ),
    /evidence/,
  );
  assert.throws(
    () => validateExplanation({ ...explanation, summary: "" }, 2),
    /summary/,
  );
});
test("web app is served with SPA fallback while unknown API routes stay JSON 404", async () => {
  const home = await mkdtemp(join(tmpdir(), "sidenote-web-"));
  const server = await createServer(home, 0);
  try {
    const page = await fetch(server.url + "/projects/some-id?file=a.ts");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(
      page.headers.get("content-security-policy"),
      /script-src 'self'/,
    );
    assert.match(await page.text(), /<div id="root">/);
    const api = await fetch(server.url + "/api/nope");
    assert.equal(api.status, 404);
    assert.deepEqual(await api.json(), { error: "Not found" });
  } finally {
    await server.app.close();
    await rm(home, { recursive: true, force: true });
  }
});
