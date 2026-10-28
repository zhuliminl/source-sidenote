import { readFile, readdir, lstat } from "node:fs/promises";
import { join, relative, extname, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import { MAX_SOURCE_BYTES, type SourceFile } from "../../domain/model.js";
import { decodeUtf8, hash } from "./files.js";

const extensions = new Set(
  ".js .jsx .ts .tsx .mjs .cjs .java .py .go .rs .c .h .cpp .hpp .cs .rb .php .swift .kt .vue .svelte .lua .sh .sql".split(
    " ",
  ),
);
const excludedDirs = new Set([
  ".git",
  ".svn",
  "node_modules",
  "target",
  "dist",
  "build",
  "coverage",
  ".next",
  ".idea",
  ".venv",
  "vendor",
]);
const builtinIgnores = [
  ".env*",
  "*.pem",
  "*.key",
  "*.lock",
  "*.min.*",
  "*.generated.*",
];

interface Scope {
  base: string;
  rules: Ignore;
}

async function localRules(dir: string): Promise<Ignore> {
  const rules = ignore();
  for (const name of [".gitignore", ".sidenoteignore"]) {
    try {
      rules.add(await readFile(join(dir, name), "utf8"));
    } catch {}
  }
  return rules;
}

/** Lists in-scope source files. Excluded parents cannot be re-included by children. */
export async function scan(root: string): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  const builtin = ignore().add(builtinIgnores);
  const toPosix = (p: string) => relative(root, p).split(sep).join("/");

  async function walk(dir: string, inherited: Scope[]) {
    const base = toPosix(dir);
    const chain = [
      ...inherited,
      { base: base ? base + "/" : "", rules: await localRules(dir) },
    ];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (
        entry.isSymbolicLink() ||
        excludedDirs.has(entry.name) ||
        entry.name.startsWith(".")
      )
        continue;
      const path = join(dir, entry.name);
      const rel = toPosix(path);
      const candidate = rel + (entry.isDirectory() ? "/" : "");
      if (
        builtin.ignores(candidate) ||
        chain.some((s) => s.rules.ignores(candidate.slice(s.base.length)))
      )
        continue;
      if (entry.isDirectory()) await walk(path, chain);
      else if (entry.isFile() && extensions.has(extname(entry.name))) {
        const { size } = await lstat(path);
        if (!size || size > MAX_SOURCE_BYTES) continue;
        const data = await readFile(path);
        if (data.includes(0) || decodeUtf8(data) === undefined) continue;
        files.push({ path: rel, hash: hash(data), bytes: size });
      }
    }
  }

  await walk(root, []);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
