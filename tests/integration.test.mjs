import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as httpServer } from "node:http";
import { createServer } from "../dist/transport/server.js";
import { scan, safeRead } from "../dist/infrastructure/scanner.js";
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
test("HTTP auth, generation, cache, stale detection, review, cancellation and restart", async () => {
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
        headers: {
          Authorization: "Bearer " + server.token,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const value = await r.json();
      assert.equal(r.status, 200, JSON.stringify(value));
      return value;
    };
    assert.equal((await fetch(server.url + "/api/config")).status, 401);
    assert.equal(
      (
        await fetch(server.url + "/api/config", {
          headers: {
            Authorization: "Bearer " + server.token,
            Origin: "https://evil.test",
          },
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
  } finally {
    if (server) await server.app.close();
    mock.closeAllConnections();
    await new Promise((r) => mock.close(r));
    await rm(home, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
test("dependency context changes invalidate explanation fingerprints", async () => {
  const { dependencyContext } =
    await import("../dist/infrastructure/scanner.js");
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
test("empty token file is replaced rather than accepting an empty bearer", async () => {
  const home = await mkdtemp(join(tmpdir(), "sidenote-token-"));
  await writeFile(join(home, "token"), "");
  const server = await createServer(home, 0);
  try {
    assert.ok(server.token.length >= 32);
    const r = await fetch(server.url + "/api/config", {
      headers: { Authorization: "Bearer " },
    });
    assert.equal(r.status, 401);
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
    const p = server.store.register("/fixture", "fixture");
    server.store.enqueue(p.id, "a.ts");
    server.store.db.exec("UPDATE jobs SET state='running'");
    const response = await fetch(server.url + "/api/events", {
      headers: { Authorization: "Bearer " + server.token },
    });
    const reader = response.body.getReader();
    await reader.read();
    await server.app.close();
    server = await createServer(home, 0);
    assert.equal(server.store.jobs()[0].state, "queued");
    await reader.cancel();
  } finally {
    await server.app.close();
    await rm(home, { recursive: true, force: true });
  }
});
test("invalid model evidence is rejected rather than counted as covered", async () => {
  const { validateExplanation } = await import("../dist/domain/types.js");
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
