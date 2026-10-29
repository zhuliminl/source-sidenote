import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { revealCentered, ripple } from "@/hooks/use-pulse";
import { ChevronRight, Search } from "lucide-react";
import type { FileEntry, FileStatus, TopicView } from "@shared/api";
import { Skeleton } from "@/components/ui/skeleton";
import { FileHint, type Hint } from "@/components/file-hint";
import { StatusDot, fileStatusLabel } from "@/components/status-dot";
import { useFiles } from "@/lib/queries";
import { splitPath } from "@/lib/format";
import { cn } from "@/lib/utils";

interface FolderNode {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
  attention: number;
}
interface FileNode {
  kind: "file";
  name: string;
  path: string;
  file: FileEntry;
}
type TreeNode = FolderNode | FileNode;

/** Per-file marker: topic status inside a topic, otherwise whether any topic covers it. */
type Mark = { status: FileStatus | "covered" | "none"; label: string };

function markOf(file: FileEntry, topic: Map<string, FileStatus> | null): Mark {
  if (topic) {
    const status = topic.get(file.path);
    return status
      ? { status, label: `主题文件 · ${fileStatusLabel[status]}` }
      : { status: "none", label: "不在当前主题" };
  }
  return file.topics.length
    ? { status: "covered", label: `${file.topics.length} 个主题覆盖` }
    : { status: "none", label: "还没有主题覆盖" };
}

const highlighted = (m: Mark) => m.status !== "none";

/** Prefers the file's own explanation, then the walkthrough's station name and the planner's reason. */
function hintsOf(topic: TopicView): Map<string, Hint> {
  const labels = new Map(topic.overview?.steps.map((s) => [s.path, s.label]));
  return new Map(
    topic.entries.map((e) => [
      e.path,
      {
        brief: e.brief || labels.get(e.path) || "",
        detail: e.summary || e.reason,
      },
    ]),
  );
}

/** Builds a sorted folder tree; single-child folder chains are compacted like VS Code. */
function buildTree(
  files: FileEntry[],
  mark: (f: FileEntry) => Mark,
): TreeNode[] {
  const root: FolderNode = {
    kind: "folder",
    name: "",
    path: "",
    children: [],
    attention: 0,
  };
  for (const file of files) {
    const parts = file.path.split("/");
    let folder = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let next = folder.children.find(
        (c): c is FolderNode => c.kind === "folder" && c.path === path,
      );
      if (!next) {
        next = {
          kind: "folder",
          name: parts[i],
          path,
          children: [],
          attention: 0,
        };
        folder.children.push(next);
      }
      folder = next;
    }
    folder.children.push({
      kind: "file",
      name: parts.at(-1)!,
      path: file.path,
      file,
    });
  }
  const finish = (node: FolderNode): FolderNode => {
    node.children = node.children
      .map((c) => (c.kind === "folder" ? finish(c) : c))
      .sort((a, b) =>
        a.kind !== b.kind
          ? a.kind === "folder"
            ? -1
            : 1
          : a.name.localeCompare(b.name),
      );
    node.attention = node.children.reduce(
      (n, c) =>
        n +
        (c.kind === "folder" ? c.attention : highlighted(mark(c.file)) ? 1 : 0),
      0,
    );
    const only = node.children[0];
    if (node.path && node.children.length === 1 && only.kind === "folder")
      return { ...only, name: `${node.name}/${only.name}` };
    return node;
  };
  return finish(root).children;
}

const ancestors = (path: string) =>
  path
    .split("/")
    .slice(0, -1)
    .map((_, i, parts) => parts.slice(0, i + 1).join("/"));

export function FileTree({
  projectId,
  topic,
  selected,
  onSelect,
  className,
}: {
  projectId: string;
  topic: TopicView | null;
  selected: string | null;
  onSelect: (path: string) => void;
  className?: string;
}) {
  const files = useFiles(projectId);
  const [query, setQuery] = useState("");
  // Inside a topic: reading order by default; the directory view can still show everything.
  const [view, setView] = useState<"order" | "tree">("order");
  const [onlyMarked, setOnlyMarked] = useState(true);
  const deferred = useDeferredValue(query.trim().toLowerCase());
  const [expanded, setExpanded] = useState<Set<string> | null>(null);

  const topicStatus = useMemo(
    () =>
      topic?.state === "confirmed" || topic?.state === "planned"
        ? new Map(topic.entries.map((e) => [e.path, e.status]))
        : null,
    [topic],
  );
  const mark = useMemo(
    () => (f: FileEntry) => markOf(f, topicStatus),
    [topicStatus],
  );
  const hints = useMemo(
    () => (topicStatus && topic ? hintsOf(topic) : new Map<string, Hint>()),
    [topic, topicStatus],
  );
  const showOrder = Boolean(topicStatus) && view === "order";
  const marked = files.data?.filter((f) => highlighted(mark(f))).length ?? 0;
  const visibleFiles = useMemo(
    () =>
      (files.data ?? []).filter(
        (f) => !topicStatus || !onlyMarked || highlighted(mark(f)),
      ),
    [files.data, onlyMarked, mark, topicStatus],
  );
  const tree = useMemo(
    () => buildTree(visibleFiles, mark),
    [visibleFiles, mark],
  );

  // Start with small projects fully open and large ones showing top-level folders.
  useEffect(() => {
    if (expanded || !files.data) return;
    const all = new Set(files.data.flatMap((f) => ancestors(f.path)));
    setExpanded(files.data.length <= 120 ? all : new Set());
  }, [files.data, expanded]);

  // Reveal the selected file, e.g. after following a relation link.
  useEffect(() => {
    if (!selected) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const a of ancestors(selected)) next.add(a);
      return next;
    });
  }, [selected]);

  // Inside a topic, open the folders that contain its files.
  useEffect(() => {
    if (!topicStatus) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const path of topicStatus.keys())
        for (const a of ancestors(path)) next.add(a);
      return next;
    });
  }, [topicStatus]);

  // Point at the newly active file: scroll it to the middle if it is out of view, then pulse it.
  const rows = useRef<HTMLDivElement>(null);
  const lastPress = useRef<{
    path: string;
    x: number;
    y: number;
    at: number;
  } | null>(null);
  useEffect(() => {
    if (!selected) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      const el = rows.current?.querySelector<HTMLElement>(
        `[data-path="${CSS.escape(selected)}"]`,
      );
      if (!el) return;
      revealCentered(el);
      // Spread from where the reader clicked, if the change came from a click on this row.
      const press = lastPress.current;
      const fresh = press?.path === selected && Date.now() - press.at < 1500;
      ripple(el, fresh ? press : undefined);
      el.classList.remove("pulse");
      void el.offsetWidth; // restart the animation
      el.classList.add("pulse");
      timer = setTimeout(() => el.classList.remove("pulse"), 800);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [selected, view, onlyMarked, Boolean(deferred)]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      // Compacted folders ("src/app") are keyed by their deepest path.
      if (next.has(path)) next.delete(path);
      else for (const a of [...ancestors(path), path]) next.add(a);
      return next;
    });

  const matches = deferred
    ? (files.data ?? []).filter((f) => f.path.toLowerCase().includes(deferred))
    : null;

  const chip = (active: boolean) =>
    cn(
      "rounded-full px-2.5 py-1 tabular-nums transition-colors",
      active
        ? "bg-accent text-foreground"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className={cn("flex min-h-0 flex-col bg-sidebar/40", className)}>
      <div className="space-y-2 p-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-full bg-muted px-3 text-sm">
          <Search className="size-3.5 shrink-0 text-subtle-foreground" />
          <span className="sr-only">搜索文件</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文件"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle-foreground"
          />
        </label>
        <div className="flex items-center gap-1 text-xs">
          {topicStatus ? (
            <>
              <button
                type="button"
                aria-pressed={view === "order"}
                onClick={() => setView("order")}
                className={chip(view === "order")}
              >
                阅读顺序
              </button>
              <button
                type="button"
                aria-pressed={view === "tree" && onlyMarked}
                onClick={() => {
                  setView("tree");
                  setOnlyMarked(true);
                }}
                className={chip(view === "tree" && onlyMarked)}
              >
                目录 {marked}
              </button>
              <button
                type="button"
                aria-pressed={view === "tree" && !onlyMarked}
                onClick={() => {
                  setView("tree");
                  setOnlyMarked(false);
                }}
                className={chip(view === "tree" && !onlyMarked)}
              >
                全部 {files.data?.length ?? ""}
              </button>
            </>
          ) : (
            <span className="px-1 text-subtle-foreground tabular-nums">
              {files.data?.length ?? ""} 个文件 · {marked} 个已被主题覆盖
            </span>
          )}
        </div>
      </div>

      <div
        ref={rows}
        onPointerDown={(e) => {
          const path = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-path]",
          )?.dataset.path;
          if (path)
            lastPress.current = {
              path,
              x: e.clientX,
              y: e.clientY,
              at: Date.now(),
            };
        }}
        role="tree"
        aria-label="项目文件"
        className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4 text-[13px] scrollbar-thin"
      >
        {files.isPending || !expanded ? (
          <div className="space-y-3 px-3 py-2">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton
                key={i}
                className="h-3.5 rounded-md"
                style={{
                  width: `${40 + ((i * 23) % 50)}%`,
                  marginLeft: (i % 3) * 12,
                }}
              />
            ))}
          </div>
        ) : matches ? (
          matches.length ? (
            matches.map((f) => (
              <SearchResult
                key={f.path}
                file={f}
                mark={mark(f)}
                hint={hints.get(f.path)}
                selected={selected === f.path}
                onSelect={onSelect}
              />
            ))
          ) : (
            <Empty>没有匹配的文件</Empty>
          )
        ) : showOrder ? (
          topic!.entries.map((e, i) => (
            <OrderItem
              key={e.path}
              index={i}
              path={e.path}
              status={e.status}
              hint={hints.get(e.path)}
              selected={selected === e.path}
              onSelect={onSelect}
            />
          ))
        ) : tree.length ? (
          <Nodes
            nodes={tree}
            depth={0}
            expanded={expanded}
            selected={selected}
            mark={mark}
            hints={hints}
            dimUnmarked={Boolean(topicStatus)}
            onToggle={toggle}
            onSelect={onSelect}
          />
        ) : (
          <Empty>没有纳入范围的源码文件</Empty>
        )}
      </div>
    </div>
  );
}

function MarkDot({ mark }: { mark: Mark }) {
  if (mark.status === "none")
    return <span className="inline-block size-1.5" aria-hidden />;
  if (mark.status === "covered")
    return (
      <span
        role="img"
        aria-label={mark.label}
        className="inline-block size-1.5 shrink-0 rounded-full bg-foreground/45"
      />
    );
  return <StatusDot status={mark.status} />;
}

function OrderItem({
  index,
  path,
  status,
  hint,
  selected,
  onSelect,
}: {
  index: number;
  path: string;
  status: FileStatus;
  hint: Hint | undefined;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const { dir, name } = splitPath(path);
  return (
    <FileHint hint={hint} path={path} status={fileStatusLabel[status]}>
      <button
        type="button"
        data-path={path}
        onClick={() => onSelect(path)}
        title={hint ? undefined : `${path} · ${fileStatusLabel[status]}`}
        className={cn(
          "relative flex w-full items-start gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/70",
          selected &&
            "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400",
        )}
      >
        <span className="mt-px w-4 shrink-0 text-right text-[11px] text-subtle-foreground tabular-nums">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn("truncate", selected && "font-medium")}>
              {name}
            </span>
            <StatusDot status={status} className="ml-auto" />
          </span>
          {dir && (
            <span className="block truncate font-mono text-[10.5px] text-subtle-foreground">
              {dir}
            </span>
          )}
        </span>
      </button>
    </FileHint>
  );
}

function Nodes({
  nodes,
  depth,
  ...props
}: {
  nodes: TreeNode[];
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  mark: (f: FileEntry) => Mark;
  hints: Map<string, Hint>;
  dimUnmarked: boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const indent = { paddingLeft: 8 + depth * 14 };
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "file") {
          const m = props.mark(node.file);
          const hint = props.hints.get(node.path);
          return (
            <FileHint
              key={node.path}
              hint={hint}
              path={node.path}
              status={m.label}
            >
              <button
                type="button"
                role="treeitem"
                aria-selected={props.selected === node.path}
                data-path={node.path}
                onClick={() => props.onSelect(node.path)}
                title={hint ? undefined : `${node.path} · ${m.label}`}
                style={indent}
                className={cn(
                  "relative flex h-7 w-full items-center gap-2 overflow-hidden rounded-md pr-2 text-left transition-colors hover:bg-accent/70",
                  props.dimUnmarked &&
                    !highlighted(m) &&
                    "text-subtle-foreground",
                  props.selected === node.path &&
                    "bg-emerald-500/10 font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400",
                )}
              >
                <span className="flex w-3.5 shrink-0 justify-center">
                  <MarkDot mark={m} />
                </span>
                <span className="truncate">{node.name}</span>
              </button>
            </FileHint>
          );
        }
        const open = props.expanded.has(node.path);
        return (
          <div key={node.path} role="group">
            <button
              type="button"
              role="treeitem"
              aria-expanded={open}
              onClick={() => props.onToggle(node.path)}
              style={indent}
              className="flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 transition-transform duration-150",
                  open && "rotate-90",
                )}
              />
              <span className="truncate">{node.name}</span>
              {!open && node.attention > 0 && (
                <span className="ml-auto text-[11px] text-subtle-foreground tabular-nums">
                  {node.attention}
                </span>
              )}
            </button>
            {open && (
              <Nodes nodes={node.children} depth={depth + 1} {...props} />
            )}
          </div>
        );
      })}
    </>
  );
}

function SearchResult({
  file,
  mark,
  hint,
  selected,
  onSelect,
}: {
  file: FileEntry;
  mark: Mark;
  hint: Hint | undefined;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const { dir, name } = splitPath(file.path);
  return (
    <FileHint hint={hint} path={file.path} status={mark.label}>
      <button
        type="button"
        data-path={file.path}
        onClick={() => onSelect(file.path)}
        className={cn(
          "relative flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/70",
          selected &&
            "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400",
        )}
      >
        <MarkDot mark={mark} />
        <span className="shrink-0">{name}</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-subtle-foreground">
          {dir}
        </span>
      </button>
    </FileHint>
  );
}

const Empty = ({ children }: { children: string }) => (
  <p className="px-3 py-6 text-center text-sm text-subtle-foreground">
    {children}
  </p>
);
