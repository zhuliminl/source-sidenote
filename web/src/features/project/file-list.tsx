import { useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { FileStatus } from "@shared/api";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/status-dot";
import { useFiles } from "@/lib/queries";
import { splitPath } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filter = "all" | "attention";
const needsAttention = (s: FileStatus) => s !== "fresh";

export function FileList({
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
  const [filter, setFilter] = useState<Filter>("all");
  const deferred = useDeferredValue(query.trim().toLowerCase());

  const visible = useMemo(
    () =>
      (files.data ?? []).filter(
        (f) =>
          (filter === "all" || needsAttention(f.status)) &&
          (!deferred || f.path.toLowerCase().includes(deferred)),
      ),
    [files.data, filter, deferred],
  );
  const attention =
    files.data?.filter((f) => needsAttention(f.status)).length ?? 0;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="space-y-2 p-3">
        <label className="flex h-9 items-center gap-2 rounded-full bg-muted px-3.5 text-sm">
          <Search className="size-4 shrink-0 text-subtle-foreground" />
          <span className="sr-only">搜索文件</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文件"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle-foreground"
          />
        </label>
        <div
          className="flex gap-1 text-xs"
          role="tablist"
          aria-label="文件筛选"
        >
          {(
            [
              ["all", `全部 ${files.data?.length ?? ""}`],
              ["attention", `待更新 ${attention}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-full px-2.5 py-1 tabular-nums transition-colors",
                filter === value
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
        {files.isPending ? (
          <div className="space-y-3 px-2.5 py-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton
                key={i}
                className="h-4 rounded-md"
                style={{ width: `${50 + ((i * 17) % 45)}%` }}
              />
            ))}
          </div>
        ) : visible.length ? (
          <ul>
            {visible.map((f) => {
              const { dir, name } = splitPath(f.path);
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => onSelect(f.path)}
                    aria-current={selected === f.path ? "true" : undefined}
                    title={f.path}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-sm transition-colors hover:bg-accent/70",
                      selected === f.path && "bg-accent hover:bg-accent",
                    )}
                  >
                    <StatusDot status={f.status} />
                    <span className="shrink-0">{name}</span>
                    <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-subtle-foreground">
                      {dir}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-2.5 py-6 text-center text-sm text-subtle-foreground">
            {files.data?.length ? "没有匹配的文件" : "没有纳入范围的源码文件"}
          </p>
        )}
      </div>
    </div>
  );
}
