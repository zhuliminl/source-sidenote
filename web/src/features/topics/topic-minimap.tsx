import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { publishMapRect } from "./map-rect";
import { revealCentered } from "@/hooks/reveal";
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

const bareName = (path: string) => splitPath(path).name.replace(/\.[^.]+$/, "");

/**
 * Stations come from the walkthrough once it exists, otherwise from the confirmed reading
 * order, named by each explanation's short name or else the file name without extension.
 */
function stationsOf(topic: TopicView): TopicStep[] {
  const entries = new Map(topic.entries.map((e) => [e.path, e]));
  if (topic.overview?.steps.length)
    return topic.overview.steps.map((s) => ({
      ...s,
      label: s.label || entries.get(s.path)?.brief || bareName(s.path),
    }));
  return topic.entries.map((e) => ({
    path: e.path,
    label: e.brief || bareName(e.path),
    description: e.summary || e.reason,
  }));
}

type Mode = "line" | "graph";

interface Size {
  w: number;
  h: number;
}
const defaultSize: Record<Mode, Size> = {
  line: { w: 400, h: 500 },
  graph: { w: 580, h: 540 },
};
const MIN: Size = { w: 300, h: 240 };

const resizeEdges: [Edge, string][] = [
  ["n", "inset-x-4 top-0 h-2 cursor-ns-resize"],
  ["s", "inset-x-4 bottom-0 h-2 cursor-ns-resize"],
  ["e", "inset-y-4 right-0 w-2 cursor-ew-resize"],
  ["w", "inset-y-4 left-0 w-2 cursor-ew-resize"],
  ["ne", "top-0 right-0 size-4 cursor-nesw-resize"],
  ["sw", "bottom-0 left-0 size-4 cursor-nesw-resize"],
  ["nw", "top-0 left-0 size-4 cursor-nwse-resize"],
  ["se", "right-0 bottom-0 size-4 cursor-nwse-resize"],
];

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * A size the reader drags from any edge or corner; remembered per map mode. The card is
 * anchored by its bottom-left corner, so dragging the left or bottom edge also moves it,
 * keeping the opposite edge where it was.
 */
function useResizable(
  key: string,
  fallback: Size,
  spot: Spot,
  place: (spot: Spot, remember: boolean) => void,
) {
  const [size, setSize] = useState<Size>(() => storage.get(key, fallback));
  useEffect(() => setSize(storage.get(key, fallback)), [key]);
  const fit = (s: Size): Size => ({
    w: Math.round(Math.max(MIN.w, Math.min(s.w, innerWidth - spot.left - 8))),
    h: Math.round(
      Math.max(MIN.h, Math.min(s.h, innerHeight - spot.bottom - 8)),
    ),
  });
  const drag = useRef<{
    edge: Edge;
    x: number;
    y: number;
    from: Size;
    at: Spot;
    /** What the last move produced; saved on release even if it has not rendered yet. */
    now: { size: Size; spot: Spot };
  } | null>(null);

  const handle = (edge: Edge) => ({
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      e.stopPropagation();
      drag.current = {
        edge,
        x: e.clientX,
        y: e.clientY,
        from: fit(size),
        at: spot,
        now: { size: fit(size), spot },
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      const between = (v: number, max: number, min: number) =>
        Math.round(Math.max(min, Math.min(v, max)));
      let { w, h } = d.from;
      let { left, bottom } = d.at;
      const right = d.at.left + d.from.w;
      const top = innerHeight - d.at.bottom - d.from.h;
      if (d.edge.includes("e"))
        w = between(d.from.w + dx, innerWidth - 8 - left, MIN.w);
      if (d.edge.includes("w")) {
        w = between(d.from.w - dx, right - 8, MIN.w);
        left = right - w;
      }
      if (d.edge.includes("n"))
        h = between(d.from.h - dy, innerHeight - 8 - bottom, MIN.h);
      if (d.edge.includes("s")) {
        h = between(d.from.h + dy, innerHeight - 8 - top, MIN.h);
        bottom = innerHeight - top - h;
      }
      d.now = { size: { w, h }, spot: { left, bottom } };
      setSize({ w, h });
      if (left !== d.at.left || bottom !== d.at.bottom)
        place({ left, bottom }, false);
    },
    onPointerUp() {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      storage.set(key, d.now.size);
      place(d.now.spot, true);
    },
  });
  return { size: fit(size), handle };
}

interface Spot {
  left: number;
  bottom: number;
}

/**
 * Keeps a floating element where the reader dragged it, anchored by its bottom-left corner
 * (so the card grows up and right from the pill), clamped to the window and remembered.
 */
function useDraggable(key: string, fallback: Spot) {
  const [spot, setSpot] = useState<Spot>(() => storage.get(key, fallback));
  const el = useRef<HTMLElement | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    from: Spot;
    moved: boolean;
  } | null>(null);
  const moved = useRef(false);

  const clamp = useCallback((s: Spot): Spot => {
    const r = el.current?.getBoundingClientRect();
    const w = r?.width ?? 160;
    const h = r?.height ?? 36;
    return {
      left: Math.round(Math.min(Math.max(8, s.left), innerWidth - w - 8)),
      bottom: Math.round(Math.min(Math.max(8, s.bottom), innerHeight - h - 8)),
    };
  }, []);
  // Stay on screen when the window shrinks or the card changes size.
  const refit = useCallback(() => setSpot((s) => clamp(s)), [clamp]);
  useEffect(() => {
    addEventListener("resize", refit);
    return () => removeEventListener("resize", refit);
  }, [refit]);

  const handle = {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      // Buttons inside the handle keep working; the handle itself is marked data-drag.
      const target = e.target as HTMLElement;
      if (
        target.closest("button, [role=tab]") &&
        !target.closest("[data-drag]")
      )
        return;
      drag.current = { x: e.clientX, y: e.clientY, from: spot, moved: false };
      moved.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = moved.current = true;
      setSpot(clamp({ left: d.from.left + dx, bottom: d.from.bottom - dy }));
    },
    onPointerUp() {
      if (drag.current?.moved) setSpot((s) => (storage.set(key, s), s));
      drag.current = null;
    },
  };
  /** True right after a drag, so the click that ends it does not also toggle. */
  const wasDragged = () => {
    const m = moved.current;
    moved.current = false;
    return m;
  };
  /** Moves the element (e.g. while resizing from its left or bottom edge). */
  const place = useCallback(
    (next: Spot, remember: boolean) => {
      setSpot(next);
      if (remember) storage.set(key, next);
    },
    [key],
  );
  return { spot, el, handle, refit, wasDragged, place };
}

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
  // The maximized view opens in the mode the small map is in, and can switch on its own.
  const [bigMode, setBigMode] = useState<Mode>(mode);
  useEffect(() => {
    if (expanded) setBigMode(mode);
  }, [expanded, mode]);
  const list = useRef<HTMLOListElement>(null);
  // Default: the window's bottom-left corner.
  const float = useDraggable("sidenote-map-spot", { left: 12, bottom: 12 });
  const { refit } = float;
  const size = useResizable(
    `sidenote-map-size:${mode}`,
    defaultSize[mode],
    float.spot,
    float.place,
  );

  // Tell panels underneath where the map is, so they can end above it instead of being covered.
  // Computed from the stored position and size, not measured, so the open animation does not jitter it.
  const { spot } = float;
  const { w, h } = size.size;
  useLayoutEffect(() => {
    const el = float.el.current;
    const width = open ? w : (el?.offsetWidth ?? 0);
    const height = open ? h : (el?.offsetHeight ?? 0);
    const bottom = innerHeight - spot.bottom;
    publishMapRect({
      left: spot.left,
      right: spot.left + width,
      top: bottom - height,
      bottom,
    });
  }, [open, spot, w, h, float.el]);
  useEffect(() => () => publishMapRect(null), []);
  useEffect(() => {
    const id = requestAnimationFrame(refit);
    return () => cancelAnimationFrame(id);
  }, [open, mode, refit]);
  const index = stations.findIndex((s) => s.path === current);

  useEffect(() => {
    if (!current || visited.includes(current)) return;
    const next = [...visited, current];
    setVisited(next);
    storage.set(visitedKey, next);
  }, [current, visited, visitedKey]);

  // Keep "you are here" in view as the reader moves along the chain.
  useEffect(() => {
    revealCentered(list.current?.querySelector('[aria-current="step"]'));
  }, [index, open, mode]);

  const toggle = (next: boolean) => {
    setOpen(next);
    storage.set("sidenote-map-open", next);
  };
  // M shows/hides the map, Shift+M opens/closes the maximized view (and M also closes it),
  // so switching between the map and the code is one key. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyM" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.repeat || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable]:not([contenteditable=false])",
        )
      )
        return;
      e.preventDefault();
      if (e.shiftKey) setExpanded((x) => !x);
      else if (expanded) setExpanded(false);
      else {
        setOpen(!open);
        storage.set("sidenote-map-open", !open);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, expanded]);
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
          ref={float.el}
          aria-label="主题地图"
          style={{ ...float.spot, width: size.size.w, height: size.size.h }}
          className="fixed z-40 flex flex-col overflow-hidden rounded-2xl border bg-popover shadow-xl animate-in fade-in-0 zoom-in-95"
        >
          {/* Resize from any edge or corner. */}
          {resizeEdges.map(([edge, place]) => (
            <div
              key={edge}
              {...size.handle(edge)}
              aria-hidden
              className={cn("absolute z-10 touch-none", place)}
            />
          ))}
          <header
            {...float.handle}
            title="拖动可移动位置"
            className="flex h-11 shrink-0 cursor-grab touch-none items-center gap-1 border-b pr-1.5 pl-3 whitespace-nowrap select-none active:cursor-grabbing"
          >
            <MapIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium">主题地图</span>
            <span className="text-xs text-subtle-foreground tabular-nums">
              {position}
            </span>
            <ModeTabs value={mode} onChange={switchMode} className="mx-auto" />
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
              aria-label="放大地图"
              title="放大地图（Shift+M）"
              onClick={() => setExpanded(true)}
              className="text-muted-foreground"
            >
              <Maximize2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="收起地图"
              title="收起地图（M）"
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
                topicId={topic.id}
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
            {mode === "graph" && <GraphLegend className="ml-auto" />}
          </footer>
        </section>
      ) : (
        <button
          ref={(node) => {
            float.el.current = node;
          }}
          type="button"
          data-drag
          {...float.handle}
          onClick={() => !float.wasDragged() && toggle(true)}
          aria-label="打开主题地图"
          title="点击或按 M 打开，拖动可移动位置"
          style={float.spot}
          className="fixed z-40 flex touch-none items-center gap-2 rounded-full border bg-popover py-1.5 pr-3.5 pl-3 text-xs shadow-lg transition-colors select-none hover:bg-accent"
        >
          <MapIcon className="size-3.5 text-muted-foreground" />
          主题地图
          <span className="text-subtle-foreground tabular-nums">
            {position}
          </span>
          <Key>M</Key>
        </button>
      )}

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className={cn(
            "flex max-h-[92vh] max-w-none flex-col sm:max-w-none",
            bigMode === "graph"
              ? "h-[92vh] w-[min(1400px,96vw)]"
              : "w-[min(1000px,94vw)] overflow-y-auto",
          )}
        >
          <div className="flex items-center gap-3 pr-8">
            <DialogTitle className="min-w-0 truncate">
              {topic.title}
            </DialogTitle>
            <ModeTabs value={bigMode} onChange={setBigMode} />
            <span className="ml-auto shrink-0 text-xs text-subtle-foreground max-sm:hidden">
              按 <Key>M</Key> 或 <Key>Esc</Key> 回到代码
            </span>
          </div>
          {bigMode === "graph" ? (
            <>
              <DialogDescription className="sr-only">
                主题结构图，可拖动站点
              </DialogDescription>
              <div className="min-h-0 flex-1 rounded-xl border bg-card p-3">
                <TopicGraph
                  topicId={topic.id}
                  stations={stations}
                  links={links}
                  current={current}
                  visited={visited}
                  onSelect={(path) => {
                    onSelect(path);
                    setExpanded(false);
                  }}
                />
              </div>
              <GraphLegend className="justify-end" />
            </>
          ) : (
            <>
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
            </>
          )}
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
        hint={{ brief: name, detail: station.description }}
        path={station.path}
        status=""
        meta={`${station.label} · 第 ${index + 1} 站${here ? " · 当前" : visited ? " · 已看过" : ""}`}
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

function ModeTabs({
  value,
  onChange,
  className,
}: {
  value: Mode;
  onChange: (mode: Mode) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="地图样式"
      className={cn(
        "flex shrink-0 rounded-full bg-muted p-0.5 text-[11px]",
        className,
      )}
    >
      {(
        [
          ["line", "线路", Rows3],
          ["graph", "结构", Share2],
        ] as const
      ).map(([v, label, Icon]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "flex items-center gap-1 rounded-full px-2 py-0.5 whitespace-nowrap text-muted-foreground transition-colors",
            value === v && "bg-background text-foreground shadow-sm",
          )}
        >
          <Icon className="size-3" />
          {label}
        </button>
      ))}
    </div>
  );
}

function GraphLegend({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-3 text-[11px] text-subtle-foreground",
        className,
      )}
    >
      <span className="flex items-center gap-1">
        <span className="w-4 border-t border-muted-foreground" />
        相互关联
      </span>
      <span className="flex items-center gap-1">
        <span className="w-4 border-t border-dashed border-subtle-foreground" />
        阅读顺序
      </span>
      <span>拖动站点可调整位置</span>
    </span>
  );
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border bg-muted px-1 font-mono text-[10px] leading-4 text-muted-foreground">
      {children}
    </kbd>
  );
}
