import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Map as MapIcon,
  Maximize2,
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

/**
 * A metro-line map of the topic, pinned under the file tree: every station is one
 * step of the chain, the current file is marked "you are here", visited stations
 * are filled in, and any station is one click away.
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
  const visitedKey = `sidenote-visited:${topic.id}`;
  const [visited, setVisited] = useState<string[]>(() =>
    storage.get(visitedKey, []),
  );
  const [collapsed, setCollapsed] = useState(() =>
    storage.get("sidenote-minimap-collapsed", false),
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
  }, [index, collapsed]);

  const go = (i: number) => {
    const s = stations[i];
    if (s) onSelect(s.path);
  };
  const seen = stations.filter((s) => visited.includes(s.path)).length;

  return (
    <section
      aria-label="主题地图"
      className="flex max-h-[46%] shrink-0 flex-col border-t bg-sidebar/70"
    >
      <header className="flex h-10 shrink-0 items-center gap-1 pr-1.5 pl-3">
        <button
          type="button"
          onClick={() => {
            setCollapsed(!collapsed);
            storage.set("sidenote-minimap-collapsed", !collapsed);
          }}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium"
        >
          <MapIcon className="size-3.5 shrink-0 text-muted-foreground" />
          主题地图
          <span className="font-normal text-subtle-foreground tabular-nums">
            {index >= 0 ? `${index + 1}/${stations.length}` : stations.length}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 text-subtle-foreground transition-transform",
              collapsed && "-rotate-90",
            )}
          />
        </button>
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
      </header>

      {!collapsed && (
        <ol
          ref={list}
          className="min-h-0 overflow-y-auto px-2 pb-3 scrollbar-thin"
        >
          {stations.map((s, i) => (
            <Station
              key={`${s.path}-${i}`}
              station={s}
              first={i === 0}
              last={i === stations.length - 1}
              here={i === index}
              visited={visited.includes(s.path)}
              onSelect={onSelect}
            />
          ))}
        </ol>
      )}
      {!collapsed && stations.length > 1 && (
        <p className="shrink-0 px-3 pb-2 text-[11px] text-subtle-foreground tabular-nums">
          已看过 {seen}/{stations.length} 站
        </p>
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
            <Diagram
              code={topic.overview.diagram}
              title={`${topic.title} · 链路全景`}
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
    </section>
  );
}

function Station({
  station,
  first,
  last,
  here,
  visited,
  onSelect,
}: {
  station: TopicStep;
  first: boolean;
  last: boolean;
  here: boolean;
  visited: boolean;
  onSelect: (path: string) => void;
}) {
  const { name } = splitPath(station.path);
  return (
    <li aria-current={here ? "step" : undefined}>
      <button
        type="button"
        onClick={() => onSelect(station.path)}
        title={`${station.path}${station.description ? `\n${station.description}` : ""}`}
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
    </li>
  );
}
