import type {
  Explanation,
  Review,
  StoryStep,
  TopicOverview,
} from "../shared/api.js";

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

const DIAGRAM_TYPES =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?)\b/;

/**
 * Diagrams are a bonus: a missing or obviously broken one is dropped instead of
 * rejecting an otherwise valid answer. Syntax errors are caught when rendering.
 */
const NODE_ID = /^[A-Za-z][A-Za-z0-9_]{0,30}$/;

/** Keeps links whose node id is well-formed; `keep` decides what else must hold. */
function cleanLinks<T extends { node: string }>(
  value: unknown,
  keep: (link: T) => boolean,
): T[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return (value as T[]).filter(
    (l) =>
      typeof l?.node === "string" &&
      NODE_ID.test(l.node) &&
      !seen.has(l.node) &&
      keep(l) &&
      seen.add(l.node),
  );
}

export function cleanDiagram(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value
    .trim()
    .replace(/^```(?:mermaid)?\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
  return DIAGRAM_TYPES.test(text) && text.length <= 6000 ? text : "";
}

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
    brief: typeof v.brief === "string" ? v.brief.trim().slice(0, 24) : "",
    summary: v.summary,
    why: typeof v.why === "string" ? v.why.trim() : "",
    scenario: isStringArray(v.scenario)
      ? v.scenario
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 10)
      : [],
    terms: Array.isArray(v.terms)
      ? v.terms
          .filter(
            (t) =>
              typeof t?.term === "string" &&
              t.term.trim() &&
              typeof t.meaning === "string" &&
              t.meaning.trim(),
          )
          .slice(0, 12)
          .map((t) => ({ term: t.term.trim(), meaning: t.meaning.trim() }))
      : [],
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
    diagram: cleanDiagram(v.diagram),
    diagramLinks: cleanLinks<Explanation["diagramLinks"][number]>(
      v.diagramLinks,
      (l) =>
        Number.isInteger(l.start) &&
        Number.isInteger(l.end) &&
        l.start >= 1 &&
        l.start <= l.end &&
        l.end <= lineCount,
    ).map(({ node, start, end }) => ({ node, start, end })),
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
      ...(e.why ? [e.why] : []),
      ...(e.diagram ? [`\`\`\`mermaid\n${e.diagram}\n\`\`\``] : []),
      ...(e.scenario?.length ? [`## 走一遍\n${list(e.scenario)}`] : []),
      `## 核心流程\n${list(e.flow)}`,
      `## 职责\n${list(e.responsibilities)}`,
      ...(e.terms?.length
        ? [
            `## 术语\n${list(e.terms.map((t) => `**${t.term}**：${t.meaning}`))}`,
          ]
        : []),
      `## 关联文件\n${list(e.relations.map((r) => `\`${r.path}\`：${r.description}`))}`,
      `## 阅读注意\n${list(e.caveats)}`,
      `## 代码依据\n${list(e.evidence.map((r) => `L${r.start}–L${r.end}：${r.explanation}`))}`,
    ].join("\n\n") + "\n"
  );
}

export interface Plan {
  title: string;
  plan: string;
  files: { path: string; reason: string }[];
}

/** Keeps only real in-scope paths (models invent some), deduplicated and capped. */
export function validatePlan(
  value: unknown,
  known: ReadonlySet<string>,
  maxFiles: number,
): Plan {
  const v = value as Plan;
  if (!v || !Array.isArray(v.files)) throw new Error("Invalid plan");
  const seen = new Set<string>();
  const files = v.files
    .filter(
      (f) =>
        typeof f?.path === "string" &&
        known.has(f.path) &&
        !seen.has(f.path) &&
        seen.add(f.path),
    )
    .slice(0, maxFiles)
    .map((f) => ({
      path: f.path,
      reason: typeof f.reason === "string" ? f.reason : "",
    }));
  if (!files.length) throw new Error("Plan selected no files in scope");
  return {
    title: typeof v.title === "string" ? v.title.trim().slice(0, 60) : "",
    plan: typeof v.plan === "string" ? v.plan : "",
    files,
  };
}

export function validateOverview(
  value: unknown,
  paths: ReadonlySet<string>,
): TopicOverview {
  const v = value as TopicOverview;
  if (!v || typeof v.summary !== "string" || !v.summary.trim())
    throw new Error("Missing overview summary");
  if (!isStringArray(v.caveats)) throw new Error("Invalid caveats");
  if (
    !Array.isArray(v.steps) ||
    !v.steps.every(
      (s) => typeof s?.path === "string" && typeof s.description === "string",
    )
  )
    throw new Error("Invalid overview steps");
  return {
    summary: v.summary,
    steps: v.steps
      .filter((s) => paths.has(s.path))
      .map(({ path, label, description }) => ({
        path,
        label:
          typeof label === "string" && label.trim()
            ? label.trim().slice(0, 24)
            : path.slice(path.lastIndexOf("/") + 1),
        description,
      })),
    caveats: v.caveats,
    diagram: cleanDiagram(v.diagram),
    diagramLinks: cleanLinks<TopicOverview["diagramLinks"][number]>(
      v.diagramLinks,
      (l) => typeof l.path === "string" && paths.has(l.path),
    ).map(({ node, path }) => ({ node, path })),
    questions: isStringArray(v.questions)
      ? v.questions
          .map((q) => q.trim())
          .filter(Boolean)
          .slice(0, 5)
          .map((q) => q.slice(0, 60))
      : [],
  };
}

const MAX_STEP_LINES = 80;

/**
 * Keeps story steps that point at real lines of a topic file. Long ranges are cut to their first
 * lines so a step always fits on screen. Fewer than two usable steps is not a story.
 */
export function validateStory(
  value: unknown,
  lineCounts: ReadonlyMap<string, number>,
): { title: string; steps: StoryStep[] } {
  const v = value as { title?: unknown; steps?: unknown };
  if (!v || !Array.isArray(v.steps)) throw new Error("Invalid story steps");
  const steps = (v.steps as Partial<StoryStep>[])
    .filter(
      (s) =>
        typeof s?.path === "string" &&
        lineCounts.has(s.path) &&
        Number.isInteger(s.start) &&
        Number.isInteger(s.end) &&
        s.start! >= 1 &&
        s.start! <= s.end! &&
        s.start! <= lineCounts.get(s.path)!,
    )
    .slice(0, 30)
    .map((s) => {
      const end = Math.min(
        s.end!,
        lineCounts.get(s.path!)!,
        s.start! + MAX_STEP_LINES - 1,
      );
      return {
        path: s.path!,
        start: s.start!,
        end,
        title:
          typeof s.title === "string" && s.title.trim()
            ? s.title.trim().slice(0, 24)
            : s.path!.slice(s.path!.lastIndexOf("/") + 1),
        narration:
          typeof s.narration === "string"
            ? s.narration.trim().slice(0, 300)
            : "",
      };
    });
  if (steps.length < 2)
    throw new Error("Story has fewer than two usable steps");
  return {
    title: typeof v.title === "string" ? v.title.trim().slice(0, 40) : "",
    steps,
  };
}
