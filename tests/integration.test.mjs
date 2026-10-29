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
  brief: "示例函数",
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
test("a single-model config from older versions becomes a provider", async () => {
  const home = await mkdtemp(join(tmpdir(), "sidenote-upgrade-"));
  let server;
  try {
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({
        baseUrl: "http://127.0.0.1:9/v1",
        model: "old-model",
        apiKey: "k",
        concurrency: 3,
      }),
    );
    server = await createServer(home, 0);
    const config = await (await fetch(server.url + "/api/config")).json();
    assert.equal(config.model, "old-model");
    assert.equal(config.concurrency, 3);
    assert.deepEqual(config.providers[0].models, [
      { id: "old-model", enabled: true },
    ]);
    assert.equal(config.providers[0].hasApiKey, true);
    assert.equal(config.active.provider, config.providers[0].id);
  } finally {
    await server?.app.close();
    await rm(home, { recursive: true, force: true });
  }
});
test("topics: plan, confirm, explain, overview, review, staleness, cancellation, restart and delete", async () => {
  const home = await mkdtemp(join(tmpdir(), "sidenote-home-"));
  const root = await mkdtemp(join(tmpdir(), "sidenote-project-"));
  const calls = { plan: 0, explain: 0, overview: 0, review: 0 };
  let delay = 0;
  let planned = [
    { path: "hello.ts", reason: "入口" },
    { path: "nope.ts", reason: "模型编造的路径" },
  ];
  let server;
  const mock = httpServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url === "/v1/models")
      return res.end(
        JSON.stringify({ data: [{ id: "fixture" }, { id: "fixture-3" }] }),
      );
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    const anthropic = req.url === "/v1/messages";
    const system = anthropic ? body.system : body.messages[0].content;
    const reply = (answer) =>
      res.end(
        JSON.stringify(
          anthropic
            ? { content: [{ type: "text", text: JSON.stringify(answer) }] }
            : { choices: [{ message: { content: JSON.stringify(answer) } }] },
        ),
      );
    // Connection tests from the settings page.
    if (system.includes("连接测试")) return reply({ ok: true });
    const kind = system.includes("挑选")
      ? "plan"
      : system.includes("导读")
        ? "overview"
        : system.includes("复查")
          ? "review"
          : "explain";
    calls[kind]++;
    await new Promise((r) => setTimeout(r, kind === "explain" ? delay : 0));
    const answers = {
      plan: { title: "问候链路", plan: "从入口读起。", files: planned },
      explain: explanation,
      overview: {
        summary: "整条链路只有一个函数。",
        steps: [
          { path: "hello.ts", description: "返回值" },
          { path: "ghost.ts", description: "x" },
        ],
        caveats: [],
      },
      review: { verdict: "pass", issues: [] },
    };
    reply(answers[kind]);
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${mock.address().port}/v1`;
  try {
    await writeFile(join(root, "hello.ts"), "export const hello = () => 1;\n");
    await writeFile(join(root, "other.ts"), "export const other = 1;\n");
    server = await createServer(home, 0);
    const call = async (path, body, method) => {
      const r = await fetch(server.url + "/api/" + path, {
        method: method || (body ? "POST" : "GET"),
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json() };
    };
    const api = async (...args) => {
      const { status, body } = await call(...args);
      assert.equal(status, 200, JSON.stringify(body));
      return body;
    };
    assert.equal(
      (
        await fetch(server.url + "/api/config", {
          headers: { Origin: "https://evil.test" },
        })
      ).status,
      403,
    );
    const invalid = await call("providers", {
      name: "x",
      baseUrl: "http://user:pass@example.com/v1",
    });
    assert.equal(invalid.status, 400);

    // Adding a project only scans it: no model calls, nothing explained.
    const { project } = await api("projects", { root });
    const id = project.id;
    assert.equal(
      (await call(`projects/${id}/topics`, { request: "x" })).status,
      400,
    );
    const { id: provider } = await api("providers", {
      name: "fixture",
      baseUrl,
      apiKey: "never-echo-this",
      models: [
        { id: "fixture", enabled: true },
        { id: "fixture-2", enabled: true },
      ],
    });
    // Only a model listed under the provider can become active.
    assert.equal(
      (await call("config", { active: { provider, model: "unlisted" } }, "PUT"))
        .status,
      400,
    );
    await api(
      "config",
      { active: { provider, model: "fixture" }, concurrency: 1 },
      "PUT",
    );
    const config = await api("config");
    assert.ok(!JSON.stringify(config).includes("never-echo-this"));
    assert.equal(config.model, "fixture");
    assert.equal(config.providers[0].hasApiKey, true);
    assert.deepEqual(await api(`providers/${provider}/discover`, {}), {
      models: ["fixture", "fixture-3"],
    });
    const ping = await api(`providers/${provider}/test`, { model: "fixture" });
    assert.equal(ping.ok, true);

    // Anthropic-style providers get the Messages protocol.
    const { id: claude } = await api("providers", {
      name: "messages",
      format: "anthropic-messages",
      baseUrl: baseUrl.replace(/\/v1$/, ""),
    });
    assert.equal(
      (await api(`providers/${claude}/test`, { model: "any" })).ok,
      true,
    );
    await api(`providers/${claude}`, undefined, "DELETE");
    assert.deepEqual((await api("projects"))[0], {
      ...project,
      total: 2,
      covered: 0,
      topics: 0,
    });

    // The prompts the service will send are published, including the user's own instructions.
    const prompts = await api("prompts");
    assert.deepEqual(
      prompts.map((p) => p.id),
      ["plan", "explain", "overview", "review"],
    );

    let topic = await api(`projects/${id}/topics`, {
      request: "hello 是怎么返回的",
      instructions: "用一句话",
    });
    assert.equal(topic.state, "planning");
    await until(
      async () => (await api(`topics/${topic.id}`)).state === "planned",
    );
    topic = await api(`topics/${topic.id}`);
    assert.equal(topic.title, "问候链路");
    // Invented paths are dropped from the plan.
    assert.deepEqual(topic.entries, [
      {
        path: "hello.ts",
        reason: "入口",
        status: "missing",
        brief: "",
        summary: "",
      },
    ]);
    assert.equal(
      calls.explain,
      0,
      "nothing is explained before the user confirms",
    );

    const confirmed = await api(`topics/${topic.id}/confirm`, {
      files: [
        ...topic.entries.map(({ path, reason }) => ({ path, reason })),
        { path: "../etc/passwd", reason: "" },
      ],
      instructions: "用一句话",
    });
    assert.equal(confirmed.queued, 1);
    await until(
      async () => (await api(`topics/${topic.id}`)).overview !== null,
    );
    topic = await api(`topics/${topic.id}`);
    assert.equal(topic.fresh, 1);
    assert.equal(topic.model, "fixture");
    // Entries carry the hover blurbs from each file's explanation.
    assert.equal(topic.entries[0].brief, "示例函数");
    assert.equal(topic.entries[0].summary, "导出示例函数。");
    assert.deepEqual(
      topic.overview.steps.map((s) => s.path),
      ["hello.ts"],
    );
    assert.equal(calls.explain, 1);
    const doc = `topics/${topic.id}/document?path=hello.ts`;
    assert.equal((await api(doc)).status, "fresh");
    assert.deepEqual(await api(`projects/${id}/files`), [
      { path: "hello.ts", bytes: 30, topics: [topic.id] },
      { path: "other.ts", bytes: 24, topics: [] },
    ]);
    assert.equal((await api("projects"))[0].covered, 1);
    // Refreshing a topic whose explanations are all fresh calls nothing.
    assert.equal((await api(`topics/${topic.id}/refresh`, {})).queued, 0);
    assert.equal(calls.explain, 1);

    await api(`topics/${topic.id}/run`, { path: "hello.ts", kind: "review" });
    await until(async () => (await api(doc)).review?.verdict === "pass");
    assert.equal(
      (
        await call(`topics/${topic.id}/run`, {
          path: "other.ts",
          kind: "generate",
        })
      ).status,
      404,
    );

    await writeFile(join(root, "hello.ts"), "export const hello = () => 2;\n");
    assert.equal((await api(doc)).status, "stale");
    // The source changes while the model is answering: the answer is discarded.
    delay = 250;
    const before = calls.explain;
    await api(`topics/${topic.id}/refresh`, {});
    await until(async () => calls.explain > before);
    await writeFile(join(root, "hello.ts"), "export const hello = () => 3;\n");
    await until(async () =>
      (await api("jobs")).some((j) => j.state === "failed"),
    );
    assert.equal((await api(doc)).status, "stale");

    delay = 1000;
    await api(`topics/${topic.id}/refresh`, {});
    await until(async () =>
      (await api("jobs")).some((j) => j.state === "running"),
    );
    const running = (await api("jobs")).find((j) => j.state === "running");
    assert.equal(running.topicTitle, "问候链路");
    await api(`jobs/${running.id}/cancel`, {});
    await until(async () =>
      (await api("jobs")).some(
        (j) => j.id === running.id && j.state === "cancelled",
      ),
    );
    await server.app.close();
    server = await createServer(home, 0);
    delay = 0;
    await api(`topics/${topic.id}/refresh`, {});
    await until(async () => (await api(doc)).status === "fresh");

    // Switching models marks earlier explanations for regeneration.
    await api("config", { active: { provider, model: "fixture-2" } }, "PUT");
    assert.equal((await api(doc)).status, "stale");
    assert.equal((await api(`topics/${topic.id}`)).entries[0].status, "stale");
    await api("config", { active: { provider, model: "fixture" } }, "PUT");

    const source = await api(`projects/${id}/source?path=hello.ts`);
    assert.equal(source.content, "export const hello = () => 3;\n");
    assert.equal(
      (await call(`projects/${id}/source?path=../x.ts`)).status,
      404,
    );

    // A failed plan can be retried; deleting a topic removes what it generated.
    planned = [{ path: "missing.ts", reason: "" }];
    const second = await api(`projects/${id}/topics`, {
      request: "不存在的功能",
    });
    await until(
      async () => (await api(`topics/${second.id}`)).state === "plan_failed",
    );
    assert.match((await api(`topics/${second.id}`)).error, /no files/);
    assert.equal((await api(`projects/${id}/topics`)).length, 2);
    await api(`topics/${topic.id}`, undefined, "DELETE");
    assert.equal((await call(doc)).status, 404);
    assert.equal((await api("projects"))[0].covered, 0);
    assert.deepEqual(
      (await api(`projects/${id}/topics`)).map((t) => t.id),
      [second.id],
    );

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
    server.container.jobs.enqueue(p.id, "topic", "a.ts");
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
test("diagrams are cleaned and broken ones dropped without rejecting the answer", () => {
  assert.equal(
    validateExplanation(
      {
        ...explanation,
        diagram: '```mermaid\nflowchart TD\n  A["读"] --> B["写"]\n```',
      },
      2,
    ).diagram,
    'flowchart TD\n  A["读"] --> B["写"]',
  );
  assert.equal(
    validateExplanation({ ...explanation, diagram: "<script>" }, 2).diagram,
    "",
  );
  assert.equal(validateExplanation(explanation, 2).diagram, "");
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
