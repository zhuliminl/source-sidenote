import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
test("Neovim adapter opens right pane, reuses it, preserves focus and closes", async (t) => {
  if (spawnSync("nvim", ["--version"]).status !== 0) {
    t.skip("Neovim unavailable");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "sidenote-nvim-"));
  try {
    const mock = join(dir, "mock.mjs");
    await writeFile(
      mock,
      "console.log(JSON.stringify({status:'fresh',markdown:'# Test explanation\\n\\nHello code.'}));",
    );
    const source = join(dir, "demo.ts");
    await writeFile(source, "export const x=1;");
    const script = join(dir, "check.lua");
    const q = (s) => "[[" + s + "]]";
    await writeFile(
      script,
      `vim.opt.runtimepath:append(${q(resolve("editors/neovim"))})
require('sidenote').setup({command={${q(process.execPath)},${q(mock)}},width=42})
vim.cmd('edit '..vim.fn.fnameescape(${q(source)}))
local original=vim.api.nvim_get_current_win()
local before=vim.fn.maparg('x','n')
vim.cmd('Sidenote')
assert(vim.wait(5000,function()
 for _,w in ipairs(vim.api.nvim_list_wins()) do
 if w~=original and vim.api.nvim_buf_get_lines(vim.api.nvim_win_get_buf(w),0,1,false)[1]=='# Test explanation' then return true end
 end
 return false
end,20),'explanation was not rendered')
assert(#vim.api.nvim_list_wins()==2)
assert(vim.api.nvim_get_current_win()==original)
for _,w in ipairs(vim.api.nvim_list_wins()) do
 if w~=original then assert(vim.api.nvim_win_get_position(w)[2]>vim.api.nvim_win_get_position(original)[2]) end
end
vim.cmd('Sidenote')
vim.wait(300)
assert(#vim.api.nvim_list_wins()==2)
assert(vim.fn.maparg('x','n')==before)
vim.cmd('SidenoteClose')
assert(#vim.api.nvim_list_wins()==1)
vim.cmd('qa!')
`,
    );
    const r = spawnSync("nvim", ["--headless", "-u", "NONE", "-l", script], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
