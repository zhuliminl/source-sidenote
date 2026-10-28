import { readFile, readdir, realpath, lstat } from "node:fs/promises";
import { join, relative, extname, sep, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import ignore from "ignore";
import type { SourceFile } from "../domain/types.js";
export const hash = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");
const extensions = new Set(
  ".js .jsx .ts .tsx .mjs .cjs .java .py .go .rs .c .h .cpp .hpp .cs .rb .php .swift .kt .vue .svelte .lua .sh .sql".split(
    " ",
  ),
);
const excluded = new Set([
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
export async function safeRead(root: string, path: string): Promise<string> {
  root = await realpath(root);
  const target = await realpath(join(root, path));
  const rel = relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("Path outside project");
  const info = await lstat(target);
  if (!info.isFile() || info.size > 128 * 1024)
    throw new Error("Source exceeds 128 KiB limit");
  return readFile(target, "utf8");
}
export async function scan(root: string): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  const rules = ignore().add([
    ".env*",
    "*.pem",
    "*.key",
    "*.lock",
    "*.min.*",
    "*.generated.*",
  ]);
  async function walk(
    dir: string,
    inherited: { base: string; rules: ReturnType<typeof ignore> }[],
  ) {
    const base = relative(root, dir).split(sep).join("/");
    const local = ignore();
    for (const name of [".gitignore", ".sidenoteignore"]) {
      try {
        local.add(await readFile(join(dir, name), "utf8"));
      } catch {}
    }
    const chain = [
      ...inherited,
      { base: base ? base + "/" : "", rules: local },
    ];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (
        entry.isSymbolicLink() ||
        excluded.has(entry.name) ||
        entry.name.startsWith(".")
      )
        continue;
      const path = join(dir, entry.name);
      const rel = relative(root, path).split(sep).join("/");
      const candidate = rel + (entry.isDirectory() ? "/" : "");
      if (
        rules.ignores(candidate) ||
        chain.some((r) => r.rules.ignores(candidate.slice(r.base.length)))
      )
        continue;
      if (entry.isDirectory()) await walk(path, chain);
      else if (entry.isFile() && extensions.has(extname(entry.name))) {
        const stat = await lstat(path);
        if (!stat.size || stat.size > 128 * 1024) continue;
        const data = await readFile(path);
        if (data.includes(0)) continue;
        files.push({ path: rel, hash: hash(data), bytes: stat.size });
      }
    }
  }
  await walk(root, []);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function context(
  root: string,
  files: SourceFile[],
): Promise<string> {
  const overview: string[] = [
    "项目文件清单（最多 2000 项）:",
    ...files.slice(0, 2000).map((f) => f.path),
  ];
  for (const name of [
    "README.md",
    "package.json",
    "pom.xml",
    "Cargo.toml",
    "go.mod",
  ]) {
    try {
      overview.push(
        `\n${name}:\n${(await safeRead(root, name)).slice(0, 10000)}`,
      );
    } catch {}
  }
  return overview.join("\n");
}
// Lightweight direct-import context. Deliberately not a full language-server graph.
export async function fileContext(
  root: string,
  files: SourceFile[],
  path: string,
  source: string,
  overview?: string,
): Promise<string> {
  const { posix } = await import("node:path");
  const known = new Set(files.map((f) => f.path));
  const related = new Set<string>();
  for (const match of source.matchAll(
    /(?:from\s*|require\s*\(\s*|import\s*)['"]([^'"]+)['"]/g,
  )) {
    const spec = match[1];
    if (!spec.startsWith(".")) continue;
    const stem = posix.normalize(posix.join(posix.dirname(path), spec));
    const candidates = [
      stem,
      ...[
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        "/index.ts",
        "/index.tsx",
        "/index.js",
      ].map((ext) => stem + ext),
    ];
    if (stem.endsWith(".js")) candidates.push(stem.slice(0, -3) + ".ts");
    const resolved = candidates.find((p) => known.has(p));
    if (resolved) related.add(resolved);
  }
  if (path.endsWith(".java"))
    for (const match of source.matchAll(
      /\bimport\s+(?:static\s+)?([\w.]+)\s*;/g,
    )) {
      const suffix = match[1].replaceAll(".", "/") + ".java";
      const resolved = files.find((f) => f.path.endsWith("/" + suffix));
      if (resolved) related.add(resolved.path);
    }
  const parts = [
    overview ?? (await context(root, files)),
    "直接依赖片段（最多 8 个，每个最多 6000 字符；没有提供的实现不能推测）:",
  ];
  for (const rel of [...related].sort().slice(0, 8)) {
    try {
      const text = await safeRead(root, rel);
      parts.push(`${rel} [sha256:${hash(text)}]\n${text.slice(0, 6000)}`);
    } catch {}
  }
  return parts.join("\n");
}
