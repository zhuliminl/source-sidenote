import { randomBytes } from "node:crypto";
import { basename, join } from "node:path";
import * as vscode from "vscode";
import type {
  DocumentView,
  Explanation,
  JobView,
  LocateResult,
  RunResult,
  TopicSummary,
  TopicView,
} from "../../../src/shared/api";
import { ApiClient, OfflineError, dataDir, locate } from "./client";
import type { FromWebview, PanelState, ToWebview, TopicRef } from "./protocol";

/**
 * Review in the editor: the explanation of the active file (through a topic) beside the code,
 * evidence blocks marked in the gutter, the block under the cursor highlighted and explained.
 * Creating topics, stories and settings stay in the web reader.
 */

type Evidence = Explanation["evidence"][number];

interface Loaded {
  uri: string;
  project: TopicRef & { root: string };
  path: string;
  topic: TopicRef;
  doc: DocumentView;
}

const fileEditor = (e = vscode.window.activeTextEditor) =>
  e?.document.uri.scheme === "file" ? e : undefined;
const topicKey = (project: string) => `sidenote.topic:${project}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The narrowest evidence block containing a 1-based line: the most specific explanation. */
function narrowest(evidence: readonly Evidence[], line: number) {
  let best = -1;
  evidence.forEach((ev, i) => {
    if (ev.start <= line && line <= ev.end) {
      const b = evidence[best];
      if (!b || ev.end - ev.start < b.end - b.start) best = i;
    }
  });
  return best < 0 ? null : best;
}

const evidenceOf = (doc: DocumentView | undefined) =>
  doc && doc.status !== "missing" ? doc.explanation.evidence : [];

class Sidenote implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private state: PanelState = { kind: "idle" };
  private target?: { uri: vscode.Uri; column?: vscode.ViewColumn };
  private loaded?: Loaded;
  private blocked: string | null = null;
  private ticket = 0;
  private active: number | null = null;
  private reloadTimer?: ReturnType<typeof setTimeout>;
  private events = new AbortController();
  private subscriptions: vscode.Disposable[] = [];
  private status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50,
  );
  /** Every evidence block of the file, as a faint gutter bar. */
  private marked = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderWidth: "0 0 0 2px",
    borderStyle: "solid",
    borderColor: new vscode.ThemeColor("editorLineNumber.foreground"),
  });
  /** The block under the cursor: the same warm highlight the web reader uses. */
  private lit = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(250, 204, 21, 0.12)",
    borderWidth: "0 0 0 2px",
    borderStyle: "solid",
    borderColor: "rgba(202, 138, 4, 0.8)",
    overviewRulerColor: "rgba(202, 138, 4, 0.8)",
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  readonly tree = new TopicTree(this);

  constructor(
    private context: vscode.ExtensionContext,
    readonly api: ApiClient,
  ) {
    this.status.command = "sidenote.chooseTopic";
    this.subscriptions.push(
      this.status,
      this.marked,
      this.lit,
      vscode.window.onDidChangeActiveTextEditor((e) => {
        const editor = fileEditor(e);
        if (editor && !this.isTarget(editor.document.uri)) this.follow(editor);
        else if (editor) this.decorate();
      }),
      vscode.window.onDidChangeTextEditorSelection(({ textEditor }) => {
        if (this.isTarget(textEditor.document.uri)) this.track(textEditor);
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => this.decorate()),
      vscode.workspace.onDidSaveTextDocument((d) => {
        if (this.isTarget(d.uri)) this.scheduleReload(0);
      }),
      vscode.workspace.onDidChangeTextDocument(({ document: d }) => {
        const s = this.state;
        if (
          this.isTarget(d.uri) &&
          s.kind === "document" &&
          s.dirty !== d.isDirty
        )
          this.post({ ...s, dirty: d.isDirty });
      }),
      vscode.languages.registerHoverProvider(
        { scheme: "file" },
        { provideHover: (d, p) => this.hover(d, p) },
      ),
    );
    this.listen();
    const editor = fileEditor();
    if (editor) this.follow(editor);
  }

  /** The topic shown for the active project, if any (for the tree view). */
  get current() {
    return this.loaded;
  }
  /** Current panel state; exposed for the extension-host smoke test. */
  get panelState() {
    return this.state;
  }

  /** Opens the explanation panel beside the editor. */
  async open() {
    const editor = fileEditor();
    if (!editor && !this.target)
      return void vscode.window.showWarningMessage("请先打开一个源码文件");
    this.ensurePanel();
    if (editor && !this.isTarget(editor.document.uri))
      return this.follow(editor);
    this.post(this.state);
  }

  async run(kind: "generate" | "review") {
    if (!this.loaded) return;
    await this.load(kind);
  }

  async chooseTopic() {
    const project = this.loaded?.project ?? (await this.projectOfActive());
    if (!project)
      return void vscode.window.showWarningMessage(
        "当前文件不在已注册的项目中",
      );
    try {
      const topics = (
        await this.api.get<TopicSummary[]>(`projects/${project.id}/topics`)
      ).filter((t) => t.state === "confirmed");
      if (!topics.length) {
        const pick = await vscode.window.showInformationMessage(
          "这个项目还没有已确认的主题。",
          "在网页里新建",
        );
        if (pick) await this.openWeb(`projects/${project.id}`);
        return;
      }
      const chosen = await vscode.window.showQuickPick(
        topics.map((t) => ({
          label: t.title,
          description: `${t.fresh}/${t.files} 份说明最新`,
          picked: t.id === this.loaded?.topic.id,
          id: t.id,
        })),
        { placeHolder: "选择要对照阅读的主题" },
      );
      if (!chosen) return;
      await this.context.workspaceState.update(topicKey(project.id), chosen.id);
      this.blocked = null;
      await this.load();
      this.tree.refresh();
    } catch (e) {
      void vscode.window.showErrorMessage(message(e));
    }
  }

  /** Opens the web reader at the same topic, file and block. */
  async openWeb(path?: string) {
    try {
      const base = await this.api.baseUrl();
      const l = this.loaded;
      let url = base;
      if (path) url = `${base}/${path}`;
      else if (l) {
        const ev =
          this.active === null ? undefined : evidenceOf(l.doc)[this.active];
        const query = new URLSearchParams({ topic: l.topic.id, file: l.path });
        if (ev) query.set("lines", `${ev.start}-${ev.end}`);
        url = `${base}/projects/${l.project.id}?${query}`;
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (e) {
      void vscode.window.showErrorMessage(message(e));
    }
  }

  async newTopic() {
    const project = this.loaded?.project ?? (await this.projectOfActive());
    await this.openWeb(project ? `projects/${project.id}` : undefined);
  }

  private async projectOfActive() {
    const editor = fileEditor();
    if (!editor) return undefined;
    try {
      return (
        (await locate(this.api, editor.document.uri.fsPath)).project ??
        undefined
      );
    } catch {
      return undefined;
    }
  }

  private isTarget(uri: vscode.Uri) {
    return this.target?.uri.toString() === uri.toString();
  }

  private follow(editor: vscode.TextEditor) {
    this.target = { uri: editor.document.uri, column: editor.viewColumn };
    this.blocked = null;
    this.active = null;
    if (this.panel)
      this.post({
        kind: "loading",
        file: basename(editor.document.uri.fsPath),
      });
    void this.load();
  }

  /** Resolves the file's topic and explanation; responses for a file no longer shown are dropped. */
  private async load(queue?: "generate" | "review") {
    const target = this.target;
    if (!target) return;
    const ticket = ++this.ticket;
    const current = () => ticket === this.ticket;
    const name = basename(target.uri.fsPath);
    try {
      const loc: LocateResult = await locate(this.api, target.uri.fsPath);
      if (!current()) return;
      const project = loc.project;
      const untracked = (text: string) => {
        this.loaded = undefined;
        this.decorate();
        this.updateStatus();
        this.tree.refresh();
        this.post({
          kind: "untracked",
          file: loc.path ?? name,
          message: text,
          project: project ? { id: project.id, title: project.name } : null,
        });
      };
      if (!project || !loc.path)
        return untracked(
          "这个文件不在已注册的项目中。在项目根目录执行 sidenote add 后即可对照阅读。",
        );
      if (!loc.inScope)
        return untracked("这个文件不在项目的扫描范围内（被忽略或不是源码）。");
      if (!loc.topics.length)
        return untracked(
          "还没有主题覆盖这个文件。在网页里新建一个主题，AI 会挑出相关文件并生成说明。",
        );
      // The topic picked for this workspace, else the newest topic covering the file.
      const stored = this.context.workspaceState.get<string>(
        topicKey(project.id),
      );
      const topic =
        loc.topics.find((t) => t.id === stored) ?? loc.topics.at(-1)!;
      const docPath = `topics/${topic.id}/document?path=${encodeURIComponent(loc.path)}`;
      if (queue) {
        const r = await this.api.post<RunResult>(`topics/${topic.id}/run`, {
          path: loc.path,
          kind: queue,
        });
        this.blocked = r.blocked;
      }
      const [doc, jobs] = await Promise.all([
        this.api.get<DocumentView>(docPath),
        this.api.get<JobView[]>("jobs"),
      ]);
      if (!current()) return;
      const job =
        jobs.find(
          (j) =>
            j.topic === topic.id &&
            j.path === loc.path &&
            (j.kind === "generate" || j.kind === "review"),
        ) ?? null;
      const changedTopic = this.loaded?.topic.id !== topic.id;
      this.loaded = {
        uri: target.uri.toString(),
        project: { id: project.id, title: project.name, root: project.root },
        path: loc.path,
        topic: { id: topic.id, title: topic.title },
        doc,
      };
      this.decorate();
      this.updateStatus();
      if (changedTopic) this.tree.refresh();
      const editorDoc = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === target.uri.toString(),
      );
      this.post({
        kind: "document",
        file: loc.path,
        project: { id: project.id, title: project.name },
        topic: { id: topic.id, title: topic.title },
        topics: loc.topics.map((t) => ({ id: t.id, title: t.title })),
        reason: topic.reason,
        doc,
        job,
        dirty: editorDoc?.isDirty ?? false,
        blocked: this.blocked,
      });
      this.postActive();
    } catch (e) {
      if (!current()) return;
      this.loaded = undefined;
      this.decorate();
      this.updateStatus();
      if (e instanceof OfflineError)
        return this.post({ kind: "offline", message: e.message });
      this.post({ kind: "error", file: name, message: message(e) });
    }
  }

  /** Gutter bars on every evidence block; the warm highlight on the one under the cursor. */
  private decorate() {
    const l = this.loaded;
    for (const editor of vscode.window.visibleTextEditors) {
      const own = l && editor.document.uri.toString() === l.uri;
      const evidence = own ? evidenceOf(l.doc) : [];
      const last = editor.document.lineCount - 1;
      const range = (ev: Evidence) =>
        new vscode.Range(
          Math.min(ev.start - 1, last),
          0,
          Math.min(ev.end - 1, last),
          0,
        );
      editor.setDecorations(this.marked, evidence.map(range));
      const lit =
        own && this.active !== null ? evidence[this.active] : undefined;
      editor.setDecorations(this.lit, lit ? [range(lit)] : []);
    }
  }

  /** Follows the cursor: the block it is in lights up here and in the panel. */
  private track(editor: vscode.TextEditor) {
    const index = narrowest(
      evidenceOf(this.loaded?.doc),
      editor.selection.active.line + 1,
    );
    if (index === this.active) return;
    this.active = index;
    this.decorate();
    this.postActive();
  }

  private postActive() {
    const editor = vscode.window.visibleTextEditors.find((e) =>
      this.isTarget(e.document.uri),
    );
    if (editor) {
      const index = narrowest(
        evidenceOf(this.loaded?.doc),
        editor.selection.active.line + 1,
      );
      if (index !== this.active) {
        this.active = index;
        this.decorate();
      }
    }
    void this.panel?.webview.postMessage({
      type: "active",
      index: this.active,
    } satisfies ToWebview);
  }

  private hover(doc: vscode.TextDocument, pos: vscode.Position) {
    const l = this.loaded;
    if (!l || doc.uri.toString() !== l.uri) return undefined;
    const evidence = evidenceOf(l.doc);
    const i = narrowest(evidence, pos.line + 1);
    if (i === null) return undefined;
    const ev = evidence[i];
    const md = new vscode.MarkdownString(
      `**L${ev.start}${ev.end !== ev.start ? `–${ev.end}` : ""}** · ${l.topic.title}\n\n${ev.explanation}`,
    );
    md.supportHtml = false;
    return new vscode.Hover(
      md,
      new vscode.Range(
        ev.start - 1,
        0,
        ev.end - 1,
        doc.lineAt(Math.min(ev.end - 1, doc.lineCount - 1)).text.length,
      ),
    );
  }

  private updateStatus() {
    const l = this.loaded;
    if (!l) return this.status.hide();
    const s = l.doc.status;
    this.status.text = `$(layers) ${l.topic.title}${s === "stale" ? " $(warning)" : ""}`;
    this.status.tooltip = `Sidenote 主题：${l.topic.title}${s === "stale" ? "（这份说明已过期）" : ""}\n点击切换主题`;
    this.status.show();
  }

  private ensurePanel() {
    if (this.panel) return;
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const dist = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    const panel = vscode.window.createWebviewPanel(
      "sidenote",
      "说明",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [media, dist],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(media, "icon.svg");
    const w = panel.webview;
    const nonce = randomBytes(16).toString("base64");
    const csp = [
      "default-src 'none'",
      // Mermaid writes a <style> element into each diagram's SVG.
      `style-src ${w.cspSource} 'unsafe-inline'`,
      `img-src ${w.cspSource} data:`,
      `font-src ${w.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    w.html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${w.asWebviewUri(vscode.Uri.joinPath(media, "panel.css"))}">
</head>
<body>
<main id="root"></main>
<script nonce="${nonce}" src="${w.asWebviewUri(vscode.Uri.joinPath(dist, "panel.js"))}"></script>
</body>
</html>`;
    w.onDidReceiveMessage((m: FromWebview) => void this.onMessage(m));
    panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.panel = panel;
  }

  async onMessage(m: FromWebview) {
    const target = this.target;
    switch (m.type) {
      case "ready":
        this.post(this.state);
        return this.postActive();
      case "generate":
        return this.run("generate");
      case "review":
        return this.run("review");
      case "web":
        return this.openWeb();
      case "chooseTopic":
        return this.chooseTopic();
      case "newTopic":
        return this.newTopic();
      case "reveal": {
        if (!target) return;
        const editor = await vscode.window.showTextDocument(target.uri, {
          viewColumn: target.column,
        });
        const last = editor.document.lineCount - 1;
        const start = Math.min(m.start - 1, last);
        const end = Math.min(m.end - 1, last);
        const range = new vscode.Range(
          start,
          0,
          end,
          editor.document.lineAt(end).text.length,
        );
        editor.selection = new vscode.Selection(range.start, range.start);
        editor.revealRange(
          range,
          vscode.TextEditorRevealType.InCenterIfOutsideViewport,
        );
        return this.track(editor);
      }
      case "open": {
        const root = this.loaded?.project.root;
        if (!root) return;
        try {
          await vscode.window.showTextDocument(
            vscode.Uri.file(join(root, ...m.path.split("/"))),
            {
              viewColumn: target?.column,
            },
          );
        } catch (e) {
          void vscode.window.showErrorMessage(message(e));
        }
        return;
      }
    }
  }

  /** Reloads on topic/job changes; reconnects with backoff while VS Code runs. */
  private listen() {
    const abort = this.events;
    void (async () => {
      for (
        let delay = 1000;
        !abort.signal.aborted;
        delay = Math.min(delay * 2, 15000)
      ) {
        try {
          await this.api.subscribe((topic) => {
            delay = 1000;
            // "hello" arrives on (re)connect, e.g. after the service starts.
            if (topic !== "config") this.scheduleReload(400);
          }, abort.signal);
        } catch {}
        if (abort.signal.aborted) return;
        await new Promise((r) => setTimeout(r, delay));
        this.scheduleReload(0);
      }
    })();
  }

  private scheduleReload(ms: number) {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      void this.load();
      this.tree.refresh();
    }, ms);
  }

  private post(state: PanelState) {
    this.state = state;
    if (!this.panel) return;
    if (state.kind !== "idle")
      this.panel.title = `说明 · ${"file" in state && state.file ? basename(state.file) : "Sidenote"}`;
    void this.panel.webview.postMessage({
      type: "state",
      state,
    } satisfies ToWebview);
  }

  dispose() {
    this.events.abort();
    clearTimeout(this.reloadTimer);
    this.panel?.dispose();
    for (const d of this.subscriptions) d.dispose();
  }
}

interface TreeEntry {
  path: string;
  status: TopicView["entries"][number]["status"];
  reason: string;
  brief: string;
  index: number;
}

/** Explorer view: the current topic's files in reading order, with their explanation status. */
class TopicTree implements vscode.TreeDataProvider<TreeEntry> {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private view?: vscode.TreeView<TreeEntry>;

  constructor(private sidenote: Sidenote) {}

  attach(view: vscode.TreeView<TreeEntry>) {
    this.view = view;
  }

  refresh() {
    this.changed.fire();
  }

  async getChildren(): Promise<TreeEntry[]> {
    const l = this.sidenote.current;
    if (this.view) {
      this.view.description = l?.topic.title ?? "";
      this.view.message = l
        ? undefined
        : "打开一个属于某个主题的文件后，这里按阅读顺序列出主题文件。";
    }
    if (!l) return [];
    try {
      const topic = await this.sidenote.api.get<TopicView>(
        `topics/${l.topic.id}`,
      );
      return topic.entries.map((e, index) => ({
        path: e.path,
        status: e.status,
        reason: e.reason,
        brief: e.brief,
        index,
      }));
    } catch {
      return [];
    }
  }

  getTreeItem(e: TreeEntry): vscode.TreeItem {
    const l = this.sidenote.current!;
    const name = e.path.slice(e.path.lastIndexOf("/") + 1);
    const item = new vscode.TreeItem(`${e.index + 1}. ${name}`);
    item.description = e.brief || e.path.slice(0, e.path.lastIndexOf("/"));
    item.tooltip = new vscode.MarkdownString(
      `**${e.path}**\n\n${e.reason}${e.status === "stale" ? "\n\n说明已过期" : e.status === "missing" ? "\n\n还没有说明" : ""}`,
    );
    item.iconPath = new vscode.ThemeIcon(
      e.status === "fresh"
        ? "pass"
        : e.status === "stale"
          ? "warning"
          : e.status === "missing"
            ? "circle-large-outline"
            : "circle-slash",
    );
    const uri = vscode.Uri.file(join(l.project.root, ...e.path.split("/")));
    item.resourceUri = uri;
    item.command = { command: "vscode.open", title: "打开", arguments: [uri] };
    return item;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const api = new ApiClient(() =>
    dataDir(vscode.workspace.getConfiguration("sidenote").get<string>("home")),
  );
  const sidenote = new Sidenote(context, api);
  const view = vscode.window.createTreeView("sidenote.topic", {
    treeDataProvider: sidenote.tree,
  });
  sidenote.tree.attach(view);
  context.subscriptions.push(
    sidenote,
    view,
    vscode.commands.registerCommand("sidenote.explain", () => sidenote.open()),
    vscode.commands.registerCommand("sidenote.regenerate", () =>
      sidenote.run("generate"),
    ),
    vscode.commands.registerCommand("sidenote.review", () =>
      sidenote.run("review"),
    ),
    vscode.commands.registerCommand("sidenote.chooseTopic", () =>
      sidenote.chooseTopic(),
    ),
    vscode.commands.registerCommand("sidenote.openWeb", () =>
      sidenote.openWeb(),
    ),
    vscode.commands.registerCommand("sidenote.newTopic", () =>
      sidenote.newTopic(),
    ),
  );
  return sidenote;
}

export function deactivate() {}
