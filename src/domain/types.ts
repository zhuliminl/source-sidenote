export interface SourceFile {
  path: string;
  hash: string;
  bytes: number;
}
export interface Project {
  id: string;
  root: string;
  name: string;
  created: string;
}
export interface Explanation {
  summary: string;
  responsibilities: string[];
  flow: string[];
  relations: { path: string; description: string }[];
  caveats: string[];
  evidence: { start: number; end: number; explanation: string }[];
}
export interface ModelConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  concurrency: number;
  maxFilesPerRun: number;
  timeoutMs: number;
}
export const defaults: ModelConfig = {
  baseUrl: "https://api.openai.com/v1",
  model: "",
  apiKey: "",
  concurrency: 2,
  maxFilesPerRun: 100,
  timeoutMs: 60000,
};
export const PROMPT_VERSION = "file-explanation-v1";
export function validateExplanation(
  value: unknown,
  lineCount: number,
): Explanation {
  const v = value as Explanation;
  if (!v || typeof v.summary !== "string" || !v.summary.trim())
    throw new Error("Missing summary");
  for (const key of ["responsibilities", "flow", "caveats"] as const)
    if (!Array.isArray(v[key]) || !v[key].every((s) => typeof s === "string"))
      throw new Error(`Invalid ${key}`);
  if (
    !Array.isArray(v.relations) ||
    !v.relations.every(
      (r) => typeof r.path === "string" && typeof r.description === "string",
    )
  )
    throw new Error("Invalid relations");
  if (
    !Array.isArray(v.evidence) ||
    !v.evidence.length ||
    !v.evidence.every(
      (e) =>
        Number.isInteger(e.start) &&
        Number.isInteger(e.end) &&
        e.start >= 1 &&
        e.end >= e.start &&
        e.end <= lineCount &&
        typeof e.explanation === "string",
    )
  )
    throw new Error("Invalid evidence ranges");
  return v;
}
export function markdown(e: Explanation, path: string): string {
  const list = (items: string[]) =>
    items.length ? items.map((s) => `- ${s}`).join("\n") : "- 无";
  return `# ${path}\n\n${e.summary}\n\n## 职责\n${list(e.responsibilities)}\n\n## 核心流程\n${list(e.flow)}\n\n## 关联文件\n${list(e.relations.map((r) => `\`${r.path}\`：${r.description}`))}\n\n## 阅读注意\n${list(e.caveats)}\n\n## 代码依据\n${list(e.evidence.map((r) => `L${r.start}–L${r.end}：${r.explanation}`))}\n`;
}
