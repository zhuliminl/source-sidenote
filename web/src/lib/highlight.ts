import type { HighlighterCore, ThemedToken } from "shiki/core";

export type { ThemedToken };

// Loaded on demand: the highlighter and each grammar are separate chunks.
const grammars: Record<string, () => Promise<{ default: unknown }>> = {
  typescript: () => import("shiki/dist/langs/typescript.mjs"),
  tsx: () => import("shiki/dist/langs/tsx.mjs"),
  javascript: () => import("shiki/dist/langs/javascript.mjs"),
  jsx: () => import("shiki/dist/langs/jsx.mjs"),
  java: () => import("shiki/dist/langs/java.mjs"),
  python: () => import("shiki/dist/langs/python.mjs"),
  go: () => import("shiki/dist/langs/go.mjs"),
  rust: () => import("shiki/dist/langs/rust.mjs"),
  c: () => import("shiki/dist/langs/c.mjs"),
  cpp: () => import("shiki/dist/langs/cpp.mjs"),
  csharp: () => import("shiki/dist/langs/csharp.mjs"),
  ruby: () => import("shiki/dist/langs/ruby.mjs"),
  php: () => import("shiki/dist/langs/php.mjs"),
  swift: () => import("shiki/dist/langs/swift.mjs"),
  kotlin: () => import("shiki/dist/langs/kotlin.mjs"),
  vue: () => import("shiki/dist/langs/vue.mjs"),
  svelte: () => import("shiki/dist/langs/svelte.mjs"),
  lua: () => import("shiki/dist/langs/lua.mjs"),
  shellscript: () => import("shiki/dist/langs/shellscript.mjs"),
  sql: () => import("shiki/dist/langs/sql.mjs"),
};

// Mirrors the scanner's extension allowlist (src/infrastructure/source/scanner.ts).
const byExtension: Record<string, keyof typeof grammars> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  java: "java",
  py: "python",
  go: "go",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  vue: "vue",
  svelte: "svelte",
  lua: "lua",
  sh: "shellscript",
  sql: "sql",
};

export function languageOf(path: string): string | undefined {
  return byExtension[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
}

let core: Promise<HighlighterCore> | undefined;
function highlighter() {
  core ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] =
      await Promise.all([
        import("shiki/core"),
        // The JS regex engine avoids WebAssembly, which our CSP does not allow.
        import("shiki/engine/javascript"),
      ]);
    return createHighlighterCore({
      themes: [
        import("shiki/dist/themes/github-light-default.mjs"),
        import("shiki/dist/themes/github-dark-default.mjs"),
      ],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  })();
  return core;
}

/** Tokens carry `--shiki-light` / `--shiki-dark` variables; CSS picks one per theme. */
export async function tokenize(
  code: string,
  path: string,
): Promise<ThemedToken[][] | null> {
  const lang = languageOf(path);
  if (!lang) return null;
  const h = await highlighter();
  if (!h.getLoadedLanguages().includes(lang))
    await h.loadLanguage((await grammars[lang]()).default as never);
  return h.codeToTokens(code, {
    lang,
    themes: { light: "github-light-default", dark: "github-dark-default" },
    defaultColor: false,
  }).tokens;
}
