import { posix } from "node:path";
import type { SourceFile } from "../../domain/model.js";
import { hash, safeRead } from "./files.js";

const OVERVIEW_FILES = [
  "README.md",
  "package.json",
  "pom.xml",
  "Cargo.toml",
  "go.mod",
];
const JS_SUFFIXES = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];
const MAX_DEPENDENCIES = 8;

/** Background context for prompts: file list plus README/build manifests. */
export async function projectOverview(
  root: string,
  files: SourceFile[],
): Promise<string> {
  const parts = [
    "项目文件清单（最多 2000 项）:",
    ...files.slice(0, 2000).map((f) => f.path),
  ];
  for (const name of OVERVIEW_FILES) {
    try {
      parts.push(`\n${name}:\n${(await safeRead(root, name)).slice(0, 10000)}`);
    } catch {}
  }
  return parts.join("\n");
}

function resolveImports(
  files: SourceFile[],
  path: string,
  source: string,
): string[] {
  const known = new Set(files.map((f) => f.path));
  const related = new Set<string>();
  for (const match of source.matchAll(
    /(?:from\s*|require\s*\(\s*|import\s*)['"]([^'"]+)['"]/g,
  )) {
    const spec = match[1];
    if (!spec.startsWith(".")) continue;
    const stem = posix.normalize(posix.join(posix.dirname(path), spec));
    const candidates = [stem, ...JS_SUFFIXES.map((s) => stem + s)];
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
  return [...related].sort().slice(0, MAX_DEPENDENCIES);
}

// Lightweight direct-import context. Deliberately not a full language-server graph.
// The fingerprint covers only these dependencies, so unrelated file additions or
// README edits do not invalidate every explanation in the project.
export async function dependencyContext(
  root: string,
  files: SourceFile[],
  path: string,
  source: string,
): Promise<{ text: string; fingerprint: string }> {
  const parts = [
    `直接依赖片段（最多 ${MAX_DEPENDENCIES} 个，每个最多 6000 字符；没有提供的实现不能推测）:`,
  ];
  const fingerprint: string[] = [];
  for (const rel of resolveImports(files, path, source)) {
    try {
      const text = await safeRead(root, rel);
      parts.push(`${rel} [sha256:${hash(text)}]\n${text.slice(0, 6000)}`);
      fingerprint.push(`${rel}:${hash(text)}`);
    } catch {}
  }
  return { text: parts.join("\n"), fingerprint: hash(fingerprint.join("\n")) };
}
