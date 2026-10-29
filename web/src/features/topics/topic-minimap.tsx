import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Map as MapIcon,
  Maximize2,
  Rows3,
  Share2,
} from "lucide-react";
import type { TopicStep, TopicView } from "@shared/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Diagram } from "@/components/diagram";
import { InlineMarkdown } from "@/components/inline-markdown";
import { FileHint } from "@/components/file-hint";
import { TopicGraph } from "./topic-graph";
import { splitPath } from "@/lib/format";
import { cn } from "@/lib/utils";

const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

/** Stations come from the walkthrough once it exists, otherwise from the confirmed reading order. */
function stationsOf(topic: TopicView): TopicStep[] {
  if (topic.overview?.steps.length)
    return topic.overview.steps.map((s) => ({
      ...s,
      label: s.label || splitPath(s.path).name,
    }));
  return topic.entries.map((e) => ({
    path: e.path,
    label: splitPath(e.path).name,
    description: e.reason,
  }));
}

type Mode = "line" | "graph";

/**
 * The topic map floats over the reader's bottom-left corner so it never takes layout space:
 * a pill when collapsed (for immersive reading), a card when open. The card shows the chain
 * either as a metro line (reading order) or as a spread-out structure graph (who calls whom).
 */
export function TopicMinimap({
  topic,
  current,
  onSelect,
}: {
  topic: TopicView;
  current: string | null;
  onSelect: (path: string) => void;
}) {
  const stations = useMemo(() => stationsOf(topic), [topic]);
  const links = useMemo(
    () => new Map(topic.entries.map((e) => [e.path, e.links ?? []])),
    [topic],
  );
  const visitedKey = `sidenote-visited:${topic.id}`;
  const [visited, setVisited] = useState<string[]>(() =>
    storage.get(visitedKey, []),
  );
  const [open, setOpen] = useState(() =>
    storage.get("sidenote-map-open", true),
  );
  const [mode, setMode] = useState<Mode>(() =>
    storage.get<Mode>("sidenote-map-mode", "line"),
  );
  const [expanded, setExpanded] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const index = stations.findIndex((s) => s.path === current);

  useEffect(() => {
    if (!current || visited.includes(current)) return;
    const next = [...visited, current];
    setVisited(next);
    storage.set(visitedKey, next);
  }, [current, visited, visitedKey]);

  // Keep "you are here" in view as the reader moves along the chain.
  useEffect(() => {
    list.current
      ?.querySelector('[aria-current="step"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [index, open, mode]);

  const toggle = (next: boolean) => {
    setOpen(next);
    storage.set("sidenote-map-open", next);
  };
  const switchMode = (next: Mode) => {
    setMode(next);
    storage.set("sidenote-map-mode", next);
  };
  const go = (i: number) => {
    const s = stations[i];
    if (s) onSelect(s.path);
  };
  const seen = stations.filter((s) => visited.includes(s.path)).length;
  const position =
    index >= 0 ? `${index + 1}/${stations.length}` : `${stations.length} 站`;

  return (
    <>
      {open ? (
        <section
          aria-label="主题地图"
          className={cn(
            "absolute bottom-3 left-3 z-30 flex flex-col overflow-hidden rounded-2xl border bg-popover shadow-xl animate-in fade-in-0 zoom-in-95",
            mode === "graph"
              ? "h-[min(440px,70vh)] w-[min(420px,calc(100%-1.5rem))]"
              : "max-h-[min(460px,70vh)] w-[min(360px,calc(100%-1.5rem))]",
          )}
        >
          <header className="flex h-11 shrink-0 items-center gap-1 border-b pr-1.5 pl-3 whitespace-nowrap">
            <MapIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium">主题地图</span>
            <span className="text-xs text-subtle-foreground tabular-nums">
              {position}
            </span>
            <div
              role="tablist"
              aria-label="地图样式"
              className="mx-auto flex rounded-full bg-muted p-0.5 text-[11px]"
            >
              {(
                [
                  ["line", "线路", Rows3],
                  ["graph", "结构", Share2],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => switchMode(value)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 whitespace-nowrap text-muted-foreground transition-colors",
                    mode === value && "bg-background text-foreground shadow-sm",
                  )}
                >
                  <Icon className="size-3" />
                  {label}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="上一站"
              title="上一站"
              disabled={index <= 0}
              onClick={() => go(index - 1)}
              className="text-muted-foreground"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="下一站"
              title="下一站"
              disabled={index >= stations.length - 1}
              onClick={() => go(index + 1)}
              className="text-muted-foreground"
            >
              <ChevronRight />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="展开链路全景"
              title="展开链路全景"
              onClick={() => setExpanded(true)}
              className="text-muted-foreground"
            >
              <Maximize2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="收起地图"
              title="收起地图"
              onClick={() => toggle(false)}
              className="text-muted-foreground"
            >
              <ChevronDown />
            </Button>
          </header>

          {mode === "line" ? (
            <ol
              ref={list}
              className="min-h-0 overflow-y-auto px-2 py-2 scrollbar-thin"
            >
              {stations.map((s, i) => (
                <Station
                  key={`${s.path}-${i}`}
                  station={s}
                  index={i}
                  first={i === 0}
                  last={i === stations.length - 1}
                  here={i === index}
                  visited={visited.includes(s.path)}
                  onSelect={onSelect}
                />
              ))}
            </ol>
          ) : (
            <div className="min-h-0 flex-1 p-2">
              <TopicGraph
                stations={stations}
                links={links}
                current={current}
                visited={visited}
                onSelect={onSelect}
              />
            </div>
          )}
          <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1.5 text-[11px] text-subtle-foreground tabular-nums">
            <span>
              已看过 {seen}/{stations.length} 站
            </span>
            {mode === "graph" && (
              <span className="ml-auto flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-4 border-t border-muted-foreground" />
                  相互关联
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-4 border-t border-dashed border-subtle-foreground" />
                  阅读顺序
                </span>
              </span>
            )}
          </footer>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => toggle(true)}
          aria-label="打开主题地图"
          className="absolute bottom-3 left-3 z-30 flex items-center gap-2 rounded-full border bg-popover py-1.5 pr-3.5 pl-3 text-xs shadow-lg transition-colors hover:bg-accent"
        >
          <MapIcon className="size-3.5 text-muted-foreground" />
          主题地图
          <span className="text-subtle-foreground tabular-nums">
            {position}
          </span>
        </button>
      )}

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-h-[92vh] w-[min(1000px,94vw)] max-w-none overflow-y-auto sm:max-w-none">
          <DialogTitle>{topic.title}</DialogTitle>
          {topic.overview?.summary && (
            <DialogDescription className="leading-6">
              {topic.overview.summary}
            </DialogDescription>
          )}
          {topic.overview?.diagram && (
            <OverviewDiagram
              topic={topic}
              current={current}
              onSelect={(path) => {
                onSelect(path);
                setExpanded(false);
              }}
            />
          )}
          <ol className="mt-1 grid gap-1 sm:grid-cols-2">
            {stations.map((s, i) => (
              <li key={`${s.path}-${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(s.path);
                    setExpanded(false);
                  }}
                  className={cn(
                    "flex h-full w-full gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted",
                    i === index && "bg-muted",
                  )}
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0 text-sm leading-6">
                    <span className="block font-medium">{s.label}</span>
                    <span className="block truncate font-mono text-[11px] text-subtle-foreground">
                      {s.path}
                    </span>
                    {s.description && (
                      <span className="text-xs leading-5 text-muted-foreground">
                        <InlineMarkdown>{s.description}</InlineMarkdown>
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The walkthrough diagram; nodes the model tied to a file open that file. */
export function OverviewDiagram({
  topic,
  current,
  onSelect,
  className,
}: {
  topic: TopicView;
  current: string | null;
  onSelect: (path: string) => void;
  className?: string;
}) {
  const links = topic.overview?.diagramLinks ?? [];
  if (!topic.overview?.diagram) return null;
  return (
    <Diagram
      code={topic.overview.diagram}
      title={`${topic.title} · 链路全景`}
      className={className}
      linked={links.map((l) => l.node)}
      active={links.filter((l) => l.path === current).map((l) => l.node)}
      onNodeClick={(node) => {
        const l = links.find((x) => x.node === node);
        if (l) onSelect(l.path);
      }}
      linkHint="点击打开这个文件"
    />
  );
}

function Station({
  station,
  index,
  first,
  last,
  here,
  visited,
  onSelect,
}: {
  station: TopicStep;
  index: number;
  first: boolean;
  last: boolean;
  here: boolean;
  visited: boolean;
  onSelect: (path: string) => void;
}) {
  const { name } = splitPath(station.path);
  return (
    <li aria-current={here ? "step" : undefined}>
      <FileHint
        hint={{ brief: station.label, detail: station.description }}
        path={station.path}
        status={`第 ${index + 1} 站${here ? " · 当前" : visited ? " · 已看过" : ""}`}
      >
        <button
          type="button"
          onClick={() => onSelect(station.path)}
          className={cn(
            "group flex w-full items-stretch gap-2.5 rounded-lg px-1.5 text-left transition-colors hover:bg-accent/70",
            here && "bg-accent hover:bg-accent",
          )}
        >
          {/* The rail: a continuous line through every station's dot. */}
          <span className="relative flex w-3 shrink-0 justify-center">
            <span
              className={cn(
                "absolute inset-y-0 w-px bg-border",
                first && "top-1/2",
                last && "bottom-1/2",
              )}
            />
            <span
              className={cn(
                "relative z-10 my-auto rounded-full",
                here
                  ? "size-2.5 bg-foreground ring-4 ring-foreground/15"
                  : visited
                    ? "size-2 bg-foreground/55"
                    : "size-2 border border-subtle-foreground/70 bg-sidebar",
              )}
            />
          </span>
          <span className="min-w-0 flex-1 py-1.5">
            <span
              className={cn(
                "block truncate text-[13px] leading-5",
                here ? "font-medium" : !visited && "text-muted-foreground",
              )}
            >
              {station.label}
            </span>
            <span className="block truncate font-mono text-[10.5px] leading-4 text-subtle-foreground">
              {name}
            </span>
          </span>
          {here && (
            <span className="my-auto shrink-0 rounded-full bg-foreground px-1.5 py-px text-[10px] text-background">
              当前
            </span>
          )}
        </button>
      </FileHint>
    </li>
  );
}
