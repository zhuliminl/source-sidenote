import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("Neovim adapter marks evidence, follows the cursor, opens the right pane and closes", async (t) => {
  if (spawnSync("nvim", ["--version"]).status !== 0) {
    t.skip("Neovim unavailable");
    return;
  }
  const dir = await realpath(await mkdtemp(join(tmpdir(), "sidenote-nvim-")));
  const source = join(dir, "demo.ts");
  await writeFile(
    source,
    "export const x = 1;\nexport const y = 2;\nexport const z = 3;\n",
  );
  // A stand-in for the service: just enough of the HTTP API for one explained file.
  const doc = {
    status: "fresh",
    path: "demo.ts",
    markdown: "",
    model: "fixture",
    generated: new Date().toISOString(),
    review: null,
    explanation: {
      brief: "",
      summary: "Hello code.",
      responsibilities: [],
      flow: ["one", "two"],
      relations: [],
      caveats: [],
      evidence: [{ start: 2, end: 3, explanation: "y and z" }],
      diagram: "",
      diagramLinks: [],
    },
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/api/locate")
      return res.end(
        JSON.stringify({
          project: { id: "p", name: "demo", root: dir },
          path: "demo.ts",
          inScope: true,
          topics: [{ id: "t", title: "Demo topic", reason: "entry" }],
        }),
      );
    if (url.pathname === "/api/topics/t/document")
      return res.end(JSON.stringify(doc));
    if (url.pathname === "/api/jobs") return res.end("[]");
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  await writeFile(
    join(dir, "connection.json"),
    JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` }),
  );
  try {
    const script = join(dir, "check.lua");
    const q = (s) => "[[" + s + "]]";
    await writeFile(
      script,
      `vim.opt.runtimepath:append(${q(resolve("editors/neovim"))})
local sn = require('sidenote')
sn.setup({home=${q(dir)},width=42})
vim.cmd('edit '..vim.fn.fnameescape(${q(source)}))
local buf = vim.api.nvim_get_current_buf()
local original = vim.api.nvim_get_current_win()
local before = vim.fn.maparg('x','n')
assert(vim.wait(5000, function() local i = sn._info(buf); return i and i.doc ~= nil end, 20), 'explanation was not loaded')
local signs = vim.api.nvim_buf_get_extmarks(buf, vim.api.nvim_get_namespaces()['sidenote'], 0, -1, {})
assert(#signs == 2, 'evidence lines 2-3 are marked, got '..#signs)
vim.api.nvim_win_set_cursor(0, {3, 0})
vim.api.nvim_exec_autocmds('CursorMoved', {})
assert(sn._active().index == 1, 'cursor block is tracked')
vim.cmd('Sidenote')
local p = sn._panel()
assert(p and vim.api.nvim_win_is_valid(p.win), 'panel opened')
local lines = vim.api.nvim_buf_get_lines(p.buf, 0, -1, false)
assert(lines[1] == '# demo.ts', 'panel header: '..tostring(lines[1]))
assert(vim.tbl_contains(lines, 'Hello code.'), 'summary rendered')
assert(#vim.api.nvim_list_wins() == 2)
assert(vim.api.nvim_get_current_win() == original, 'focus stays in the code')
assert(vim.api.nvim_win_get_position(p.win)[2] > vim.api.nvim_win_get_position(original)[2], 'panel is on the right')
vim.cmd('Sidenote')
assert(#vim.api.nvim_list_wins() == 2, 'panel is reused')
assert(vim.fn.maparg('x','n') == before, 'no global mappings')
vim.cmd('SidenoteClose')
assert(#vim.api.nvim_list_wins() == 1)
vim.cmd('qa!')
`,
    );
    const r = await new Promise((done) => {
      const child = spawn("nvim", ["--headless", "-u", "NONE", "-l", script], {
        env: { ...process.env, SIDENOTE_HOME: dir },
      });
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      const timer = setTimeout(() => child.kill(), 15000);
      child.on("close", (status) => {
        clearTimeout(timer);
        done({ status, stderr });
      });
    });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
