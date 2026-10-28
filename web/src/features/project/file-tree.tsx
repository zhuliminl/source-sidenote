import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import type { FileEntry, FileStatus } from "@shared/api";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/status-dot";
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

const needsAttention = (s: FileStatus) => s !== "fresh";

/** Builds a sorted folder tree; single-child folder chains are compacted like VS Code. */
function buildTree(files: FileEntry[]): TreeNode[] {
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
        (c.kind === "folder"
          ? c.attention
          : needsAttention(c.file.status)
            ? 1
            : 0),
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
  selected,
  onSelect,
  className,
}: {
  projectId: string;
  selected: string | null;
  onSelect: (path: string) => void;
  className?: string;
}) {
  const files = useFiles(projectId);
  const [query, setQuery] = useState("");
  const [onlyAttention, setOnlyAttention] = useState(false);
  const deferred = useDeferredValue(query.trim().toLowerCase());
  const [expanded, setExpanded] = useState<Set<string> | null>(null);

  const visibleFiles = useMemo(
    () =>
      (files.data ?? []).filter(
        (f) => !onlyAttention || needsAttention(f.status),
      ),
    [files.data, onlyAttention],
  );
  const tree = useMemo(() => buildTree(visibleFiles), [visibleFiles]);
  const attention =
    files.data?.filter((f) => needsAttention(f.status)).length ?? 0;

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

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      // Compacted folders ("src/app") are keyed by their deepest path.
      if (next.has(path)) next.delete(path);
      else for (const a of [...ancestors(path), path]) next.add(a);
      return next;
    });

  const matches = deferred
    ? visibleFiles.filter((f) => f.path.toLowerCase().includes(deferred))
    : null;

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
          {[
            [false, `全部 ${files.data?.length ?? ""}`],
            [true, `待更新 ${attention}`],
          ].map(([value, label]) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={onlyAttention === value}
              onClick={() => setOnlyAttention(value as boolean)}
              className={cn(
                "rounded-full px-2.5 py-1 tabular-nums transition-colors",
                onlyAttention === value
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
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
                selected={selected === f.path}
                onSelect={onSelect}
              />
            ))
          ) : (
            <Empty>没有匹配的文件</Empty>
          )
        ) : tree.length ? (
          <Nodes
            nodes={tree}
            depth={0}
            expanded={expanded}
            selected={selected}
            onToggle={toggle}
            onSelect={onSelect}
          />
        ) : (
          <Empty>
            {onlyAttention ? "所有说明都是最新的" : "没有纳入范围的源码文件"}
          </Empty>
        )}
      </div>
    </div>
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
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const indent = { paddingLeft: 8 + depth * 14 };
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "file")
          return (
            <button
              key={node.path}
              type="button"
              role="treeitem"
              aria-selected={props.selected === node.path}
              onClick={() => props.onSelect(node.path)}
              title={`${node.path} · ${node.file.status === "fresh" ? "说明最新" : node.file.status === "stale" ? "说明已过期" : "未生成说明"}`}
              style={indent}
              className={cn(
                "flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left transition-colors hover:bg-accent/70",
                props.selected === node.path &&
                  "bg-accent font-medium hover:bg-accent",
              )}
            >
              <span className="flex w-3.5 shrink-0 justify-center">
                <StatusDot status={node.file.status} />
              </span>
              <span className="truncate">{node.name}</span>
            </button>
          );
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
                <span
                  className="ml-auto size-1.5 shrink-0 rounded-full bg-warning"
                  aria-label={`${node.attention} 个待更新`}
                />
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
  selected,
  onSelect,
}: {
  file: FileEntry;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const { dir, name } = splitPath(file.path);
  return (
    <button
      type="button"
      onClick={() => onSelect(file.path)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/70",
        selected && "bg-accent hover:bg-accent",
      )}
    >
      <StatusDot status={file.status} />
      <span className="shrink-0">{name}</span>
      <span className="min-w-0 truncate font-mono text-[11px] text-subtle-foreground">
        {dir}
      </span>
    </button>
  );
}

const Empty = ({ children }: { children: string }) => (
  <p className="px-3 py-6 text-center text-sm text-subtle-foreground">
    {children}
  </p>
);
