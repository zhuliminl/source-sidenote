import type { Explanation, Review } from "../shared/api.js";

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

/** Rejects model output that is malformed or cites lines outside the file. */
export function validateExplanation(
  value: unknown,
  lineCount: number,
): Explanation {
  const v = value as Explanation;
  if (!v || typeof v.summary !== "string" || !v.summary.trim())
    throw new Error("Missing summary");
  for (const key of ["responsibilities", "flow", "caveats"] as const)
    if (!isStringArray(v[key])) throw new Error(`Invalid ${key}`);
  if (
    !Array.isArray(v.relations) ||
    !v.relations.every(
      (r) => typeof r?.path === "string" && typeof r.description === "string",
    )
  )
    throw new Error("Invalid relations");
  if (
    !Array.isArray(v.evidence) ||
    !v.evidence.length ||
    !v.evidence.every(
      (e) =>
        Number.isInteger(e?.start) &&
        Number.isInteger(e.end) &&
        e.start >= 1 &&
        e.end >= e.start &&
        e.end <= lineCount &&
        typeof e.explanation === "string",
    )
  )
    throw new Error("Invalid evidence ranges");
  return {
    summary: v.summary,
    responsibilities: v.responsibilities,
    flow: v.flow,
    relations: v.relations.map(({ path, description }) => ({
      path,
      description,
    })),
    caveats: v.caveats,
    evidence: v.evidence.map(({ start, end, explanation }) => ({
      start,
      end,
      explanation,
    })),
  };
}

/**
 * Models sometimes cite files outside the scanned set (package.json, docs).
 * Drop those relations instead of discarding an otherwise valid, paid-for answer.
 */
export function keepKnownRelations(
  e: Explanation,
  known: ReadonlySet<string>,
): Explanation {
  return { ...e, relations: e.relations.filter((r) => known.has(r.path)) };
}

export function validateReview(
  value: unknown,
): Pick<Review, "verdict" | "issues"> {
  const v = value as Review;
  if (
    !v ||
    !["pass", "needs_changes"].includes(v.verdict) ||
    !isStringArray(v.issues) ||
    (v.verdict === "pass" && v.issues.length)
  )
    throw new Error("Invalid review result");
  return { verdict: v.verdict, issues: v.issues };
}

export function renderMarkdown(e: Explanation, path: string): string {
  const list = (items: string[]) =>
    items.length ? items.map((s) => `- ${s}`).join("\n") : "- 无";
  return (
    [
      `# ${path}`,
      e.summary,
      `## 职责\n${list(e.responsibilities)}`,
      `## 核心流程\n${list(e.flow)}`,
      `## 关联文件\n${list(e.relations.map((r) => `\`${r.path}\`：${r.description}`))}`,
      `## 阅读注意\n${list(e.caveats)}`,
      `## 代码依据\n${list(e.evidence.map((r) => `L${r.start}–L${r.end}：${r.explanation}`))}`,
    ].join("\n\n") + "\n"
  );
}
