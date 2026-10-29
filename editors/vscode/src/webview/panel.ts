// Runs inside the webview. Builds DOM with textContent only: model output is never parsed as HTML
// (Mermaid renders diagrams in strict mode, which sanitises labels).
import mermaid from "mermaid";
import type { DocumentView, Review } from "../../../../src/shared/api";
import type { FromWebview, PanelState, ToWebview } from "../protocol";

declare function acquireVsCodeApi(): {
  postMessage(message: FromWebview): void;
};

type Doc = Exclude<DocumentView, { status: "missing" }>;
type Child = Node | string | null | undefined | false;

const vscode = acquireVsCodeApi();
const root = document.getElementById("root")!;
const send = (m: FromWebview) => vscode.postMessage(m);
let state: PanelState = { kind: "idle" };
let active: number | null = null;

function h(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: Child[]
) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

function button(
  label: Child,
  onClick: () => void,
  attrs: Record<string, string> = {},
) {
  const el = h("button", { type: "button", ...attrs }, label);
  el.addEventListener("click", onClick);
  return el;
}

/** Inline markdown subset used by explanations: `code` and **bold**. */
function inline(text: string) {
  const span = h("span");
  for (const part of text.split(/(`[^`]+`|\*\*[^*]+\*\*)/)) {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1)
      span.append(h("code", {}, part.slice(1, -1)));
    else if (part.startsWith("**") && part.endsWith("**") && part.length > 3)
      span.append(h("strong", {}, part.slice(2, -2)));
    else if (part) span.append(part);
  }
  return span;
}

function section(title: string, body: Child, hint?: string) {
  return h(
    "section",
    {},
    h("h2", {}, title, hint && h("span", { class: "hint" }, hint)),
    body,
  );
}

function list(title: string, items: string[], ordered = false) {
  if (!items.length) return null;
  return section(
    title,
    h(ordered ? "ol" : "ul", {}, ...items.map((i) => h("li", {}, inline(i)))),
  );
}

function notice(tone: "info" | "warn" | "error", ...children: Child[]) {
  return h("div", { class: `notice ${tone}` }, ...children);
}

function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

// ---- diagrams ----------------------------------------------------------------

const dark = () =>
  document.body.classList.contains("vscode-dark") ||
  document.body.classList.contains("vscode-high-contrast");
let configured: boolean | undefined;
let renders = 0;
const svgCache = new Map<string, string>();

async function renderDiagram(code: string): Promise<string> {
  const theme = dark();
  const key = `${theme}:${code}`;
  const cached = svgCache.get(key);
  if (cached) return cached;
  if (configured !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme ? "dark" : "neutral",
      fontFamily: "inherit",
      flowchart: { htmlLabels: false, curve: "basis" },
    });
    configured = theme;
  }
  const id = `diagram${++renders}`;
  try {
    const { svg } = await mermaid.render(id, code);
    svgCache.set(key, svg);
    return svg;
  } finally {
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

/** Mermaid flowchart nodes render as <g class="node" id="<svg>-flowchart-<id>-<n>">. */
const nodeId = (el: Element) =>
  el.getAttribute("data-id") ?? el.id.match(/flowchart-(.+)-\d+$/)?.[1] ?? null;

function diagram(doc: Doc) {
  const e = doc.explanation;
  if (!e.diagram) return null;
  const links = e.diagramLinks ?? [];
  const box = h(
    "figure",
    { class: "diagram" },
    h("p", { class: "muted" }, "正在绘制图…"),
  );
  void renderDiagram(e.diagram).then(
    (svg) => {
      box.innerHTML = svg;
      for (const node of box.querySelectorAll("g.node")) {
        const id = nodeId(node);
        const link = id ? links.find((l) => l.node === id) : undefined;
        if (!link) continue;
        node.classList.add("linked");
        node.setAttribute("data-start", String(link.start));
        node.setAttribute("data-end", String(link.end));
        node.addEventListener("click", () =>
          send({ type: "reveal", start: link.start, end: link.end }),
        );
      }
      markActive();
    },
    () => {
      box.replaceChildren(
        h(
          "details",
          {},
          h("summary", {}, "图表无法渲染，查看源码"),
          h("pre", {}, e.diagram),
        ),
      );
    },
  );
  return box;
}

// ---- document ----------------------------------------------------------------

function reviewSection(review: Review | null) {
  if (!review) return null;
  const pass = review.verdict === "pass";
  return section(
    "AI 复查",
    h(
      "div",
      { class: `review ${pass ? "pass" : "fail"}` },
      h(
        "p",
        {},
        pass ? "复查通过" : "复查认为需要修改",
        h(
          "span",
          { class: "meta" },
          ` · ${review.model} · ${when(review.checked)}`,
        ),
      ),
      review.issues.length > 0 &&
        h("ul", {}, ...review.issues.map((i) => h("li", {}, inline(i)))),
    ),
  );
}

function body(doc: Doc) {
  const e = doc.explanation;
  const evidence = h(
    "ul",
    { class: "items evidence" },
    ...e.evidence.map((ev, i) => {
      const range =
        ev.end !== ev.start ? `L${ev.start}–${ev.end}` : `L${ev.start}`;
      const b = h(
        "button",
        { type: "button", class: "item", title: "在编辑器中定位这段代码" },
        h("span", { class: "range" }, range),
        inline(ev.explanation),
      );
      b.addEventListener("click", () =>
        send({ type: "reveal", start: ev.start, end: ev.end }),
      );
      return h("li", { "data-evidence": String(i) }, b);
    }),
  );
  const relations = h(
    "ul",
    { class: "items" },
    ...e.relations.map((r) => {
      const b = h(
        "button",
        { type: "button", class: "item column", title: "打开文件" },
        h("span", { class: "path" }, r.path),
        inline(r.description),
      );
      b.addEventListener("click", () => send({ type: "open", path: r.path }));
      return h("li", {}, b);
    }),
  );
  return [
    h("p", { class: "summary" }, inline(e.summary)),
    e.why && h("p", { class: "why" }, inline(e.why)),
    h("p", { class: "meta" }, `${doc.model} · ${when(doc.generated)}`),
    diagram(doc),
    list("走一遍", e.scenario ?? [], true),
    list("核心流程", e.flow, true),
    list("职责", e.responsibilities),
    (e.terms?.length ?? 0) > 0 &&
      section(
        "术语",
        h(
          "ul",
          {},
          ...e.terms.map((t) =>
            h("li", {}, h("strong", {}, t.term), "：", inline(t.meaning)),
          ),
        ),
      ),
    e.evidence.length > 0 &&
      section("代码依据", evidence, "点击定位；光标所在的段落会自动对应到这里"),
    e.relations.length > 0 && section("关联文件", relations),
    list("阅读注意", e.caveats),
    reviewSection(doc.review),
  ];
}

function header(file: string, ...actions: Child[]) {
  return h(
    "header",
    {},
    h("span", { class: "file", title: file }, file),
    h("span", { class: "actions" }, ...actions),
  );
}

function render(s: PanelState): Child[] {
  switch (s.kind) {
    case "idle":
      return [];
    case "loading":
      return [header(s.file), h("p", { class: "muted" }, "正在读取说明…")];
    case "offline":
      return [
        notice(
          "error",
          h("strong", {}, "Source Sidenote 服务未运行"),
          h("p", {}, s.message),
        ),
        h("p", { class: "muted" }, "启动服务后此面板会自动重连。"),
        h("pre", {}, "sidenote start"),
      ];
    case "error":
      return [
        header(s.file ?? ""),
        notice(
          "error",
          h("strong", {}, "暂时无法获取说明"),
          h("p", {}, s.message),
        ),
      ];
    case "untracked":
      return [
        header(s.file),
        notice(
          "info",
          h("p", {}, s.message),
          s.project &&
            button("在网页里新建主题", () => send({ type: "newTopic" })),
        ),
      ];
    case "document": {
      const { doc, job, dirty, blocked } = s;
      const busy = job?.state === "queued" || job?.state === "running";
      const status =
        doc.status === "missing"
          ? null
          : h(
              "span",
              { class: `badge ${doc.status}` },
              doc.status === "fresh" ? "最新" : "已过期",
            );
      const actions = [
        status,
        doc.status === "fresh" &&
          button("复查", () => send({ type: "review" }), {
            class: "secondary",
            title: "让 AI 对照源码复查这份说明",
            ...(busy ? { disabled: "" } : {}),
          }),
        doc.status !== "missing" &&
          button("重新生成", () => send({ type: "generate" }), {
            class: "secondary",
            ...(busy ? { disabled: "" } : {}),
          }),
        button("网页阅读", () => send({ type: "web" }), {
          class: "secondary",
          title: "在网页阅读器中打开同一主题、文件和代码段",
        }),
      ];
      const topicBar = h(
        "div",
        { class: "topic" },
        button(
          h(
            "span",
            {},
            "主题：",
            h("strong", {}, s.topic.title),
            s.topics.length > 1 ? " ▾" : "",
          ),
          () => send({ type: "chooseTopic" }),
          { class: "link", title: "切换主题" },
        ),
        s.reason && h("p", { class: "muted" }, s.reason),
      );
      const notes: Child[] = [
        dirty &&
          notice(
            "info",
            h("p", {}, "文件有未保存的修改；说明针对磁盘上已保存的版本。"),
          ),
        blocked && notice("error", h("p", {}, blocked)),
        busy &&
          notice(
            "info",
            h(
              "p",
              {},
              job!.kind === "review"
                ? "正在复查，完成后自动刷新…"
                : job!.state === "running"
                  ? "正在生成说明，完成后自动刷新…"
                  : "已加入队列，完成后自动刷新…",
            ),
          ),
        !busy &&
          job?.state === "failed" &&
          notice(
            "error",
            h(
              "strong",
              {},
              job.kind === "review" ? "上次复查失败" : "上次生成失败",
            ),
            h("p", {}, job.error ?? ""),
          ),
      ];
      const head = header(s.file, ...actions);
      if (doc.status === "missing")
        return [
          head,
          topicBar,
          ...notes,
          h(
            "div",
            { class: "empty" },
            h("p", {}, "这个文件在主题里还没有说明。"),
            h(
              "p",
              { class: "muted" },
              "生成会把该文件和有限上下文发送给这个主题所选的模型。",
            ),
            button(
              "生成说明",
              () => send({ type: "generate" }),
              busy ? { disabled: "" } : {},
            ),
          ),
        ];
      return [
        head,
        topicBar,
        ...notes,
        doc.status === "stale" &&
          notice(
            "warn",
            h("p", {}, "源码、直接依赖或模型已变化，说明可能不准确。"),
            button(
              "重新生成",
              () => send({ type: "generate" }),
              busy ? { disabled: "" } : {},
            ),
          ),
        ...body(doc),
      ];
    }
  }
}

/** Mirrors the editor cursor: the evidence entry (and diagram node) of its block. */
function markActive(scroll = false) {
  for (const el of root.querySelectorAll("[data-evidence]"))
    el.classList.toggle(
      "active",
      el.getAttribute("data-evidence") === String(active),
    );
  const ev =
    state.kind === "document" &&
    state.doc.status !== "missing" &&
    active !== null
      ? state.doc.explanation.evidence[active]
      : undefined;
  // The node whose lines overlap the block most (narrower wins a tie) stands for it.
  let best: Element | null = null;
  let score = [-1, 0];
  for (const node of root.querySelectorAll("g.node.linked")) {
    node.classList.remove("active");
    if (!ev) continue;
    const start = Number(node.getAttribute("data-start"));
    const end = Number(node.getAttribute("data-end"));
    const overlap = Math.min(end, ev.end) - Math.max(start, ev.start);
    if (overlap < 0) continue;
    if (
      overlap > score[0] ||
      (overlap === score[0] && end - start < score[1])
    ) {
      best = node;
      score = [overlap, end - start];
    }
  }
  best?.classList.add("active");
  if (scroll)
    root
      .querySelector(`[data-evidence="${active}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

window.addEventListener("message", (event: MessageEvent<ToWebview>) => {
  const m = event.data;
  if (m?.type === "active") {
    active = m.index;
    return markActive(true);
  }
  if (m?.type !== "state") return;
  const scroll = window.scrollY;
  const file = "file" in m.state ? (m.state.file ?? "") : "";
  const same = root.dataset.file === file;
  state = m.state;
  if (!same) active = null;
  root.replaceChildren(
    ...render(m.state).filter((c): c is Node | string => Boolean(c)),
  );
  root.dataset.file = file;
  markActive();
  // Keep the reading position across live refreshes of the same file.
  window.scrollTo(0, same ? scroll : 0);
});

send({ type: "ready" });
