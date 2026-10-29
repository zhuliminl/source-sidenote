import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import type { TopicStep } from "@shared/api";
import { FileHint } from "@/components/file-hint";
import { cn } from "@/lib/utils";
import { splitPath } from "@/lib/format";
import { usePulse } from "@/hooks/use-pulse";

interface Edge {
  a: number;
  b: number;
  /** "order": next station in the reading order; "link": one explanation names the other file. */
  kind: "order" | "link";
}

const NODE_H = 26;
const MAX_CHARS = 14;
// CJK characters take about twice the width of Latin ones at this size.
const textWidth = (s: string) =>
  [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 11.5 : 6.6), 0);
const short = (label: string) =>
  [...label].length > MAX_CHARS
    ? [...label].slice(0, MAX_CHARS - 1).join("") + "…"
    : label;
const width = (label: string) => Math.min(170, 20 + textWidth(short(label)));

/**
 * Deterministic force layout (Fruchterman–Reingold, then a pass that pushes overlapping
 * boxes apart). Stations start on a circle in reading order, so the result is stable.
 */
function layout(labels: string[], edges: Edge[]) {
  const n = labels.length;
  const K = 96;
  const pos = labels.map((_, i) => {
    const a = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(a) * K * 1.4, y: Math.sin(a) * K * 1.4 };
  });
  const iterations = 360;
  for (let it = 0; it < iterations; it++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const f = (K * K) / d;
        disp[i].x += (dx / d) * f;
        disp[i].y += (dy / d) * f;
        disp[j].x -= (dx / d) * f;
        disp[j].y -= (dy / d) * f;
      }
    for (const e of edges) {
      const dx = pos[e.a].x - pos[e.b].x;
      const dy = pos[e.a].y - pos[e.b].y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = ((d * d) / K) * (e.kind === "link" ? 1.2 : 0.8);
      disp[e.a].x -= (dx / d) * f;
      disp[e.a].y -= (dy / d) * f;
      disp[e.b].x += (dx / d) * f;
      disp[e.b].y += (dy / d) * f;
    }
    const t = 24 * (1 - it / iterations) + 0.5;
    for (let i = 0; i < n; i++) {
      // Gentle pull to the centre keeps unconnected stations from drifting away.
      disp[i].x -= pos[i].x * 0.6;
      disp[i].y -= pos[i].y * 0.6;
      const d = Math.max(1, Math.hypot(disp[i].x, disp[i].y));
      pos[i].x += (disp[i].x / d) * Math.min(d, t);
      pos[i].y += (disp[i].y / d) * Math.min(d, t);
    }
  }
  const w = labels.map(width);
  for (let it = 0; it < 80; it++)
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const ox = (w[i] + w[j]) / 2 + 10 - Math.abs(pos[i].x - pos[j].x);
        const oy = NODE_H + 14 - Math.abs(pos[i].y - pos[j].y);
        if (ox <= 0 || oy <= 0) continue;
        // Separate along the axis that needs the smaller move.
        if (ox < oy) {
          const s = (pos[i].x < pos[j].x ? -1 : 1) * (ox / 2);
          pos[i].x += s;
          pos[j].x -= s;
        } else {
          const s = (pos[i].y < pos[j].y ? -1 : 1) * (oy / 2);
          pos[i].y += s;
          pos[j].y -= s;
        }
      }
  return pos.map((p, i) => ({ ...p, w: w[i] }));
}

/** Where the segment from a box centre towards (dx, dy) leaves the box. */
function exit(w: number, dx: number, dy: number) {
  const t = Math.min(
    dx ? w / 2 / Math.abs(dx) : Infinity,
    dy ? NODE_H / 2 / Math.abs(dy) : Infinity,
  );
  return { x: dx * t, y: dy * t };
}

type Point = { x: number; y: number };
type Placed = Record<string, Point>;

/** Where the reader dragged each station, per topic; shared by every graph of that topic. */
const placedKey = (topic: string) => `sidenote-graph-pos:${topic}`;
const PLACED_EVENT = "sidenote-graph-pos";
function readPlaced(topic: string): Placed {
  try {
    return JSON.parse(localStorage.getItem(placedKey(topic)) ?? "{}") as Placed;
  } catch {
    return {};
  }
}
function writePlaced(topic: string, placed: Placed) {
  try {
    if (Object.keys(placed).length)
      localStorage.setItem(placedKey(topic), JSON.stringify(placed));
    else localStorage.removeItem(placedKey(topic));
  } catch {}
  // Keep the small map and the maximized one in step.
  dispatchEvent(new CustomEvent(PLACED_EVENT, { detail: topic }));
}

/**
 * The topic as a spread-out graph: stations are files, solid lines are relations named in the
 * explanations, dashed arrows are the reading order. Hovering a station lights up its neighbours.
 * Stations can be dragged; where the reader puts them is remembered, to build a mental map.
 */
export function TopicGraph({
  topicId,
  stations,
  links,
  current,
  visited,
  onSelect,
  className,
}: {
  topicId: string;
  stations: TopicStep[];
  /** path → related topic files */
  links: Map<string, string[]>;
  current: string | null;
  visited: readonly string[];
  onSelect: (path: string) => void;
  className?: string;
}) {
  const arrow = `arrow${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [placed, setPlaced] = useState<Placed>(() => readPlaced(topicId));
  const [dragging, setDragging] = useState<{ i: number; at: Point } | null>(
    null,
  );
  const drag = useRef<{
    i: number;
    grab: Point;
    origin: Point;
    moved: boolean;
  } | null>(null);
  const frozen = useRef<string | null>(null);

  useEffect(() => {
    setPlaced(readPlaced(topicId));
    const sync = (e: Event) =>
      (e as CustomEvent<string>).detail === topicId &&
      setPlaced(readPlaced(topicId));
    addEventListener(PLACED_EVENT, sync);
    return () => removeEventListener(PLACED_EVENT, sync);
  }, [topicId]);

  const { auto, edges } = useMemo(() => {
    const index = new Map(stations.map((s, i) => [s.path, i]));
    const edges: Edge[] = [];
    const seen = new Set<string>();
    stations.forEach((s, i) => {
      if (i + 1 < stations.length)
        edges.push({ a: i, b: i + 1, kind: "order" });
      for (const p of links.get(s.path) ?? []) {
        const j = index.get(p);
        if (j === undefined || j === i || Math.abs(i - j) === 1) continue;
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ a: i, b: j, kind: "link" });
      }
    });
    return {
      auto: layout(
        stations.map((s) => s.label),
        edges,
      ),
      edges,
    };
  }, [stations, links]);

  const nodes = auto.map((p, i) => {
    if (dragging?.i === i) return { ...p, ...dragging.at };
    const saved = placed[stations[i].path];
    return saved ? { ...p, ...saved } : p;
  });

  // Fit the view to the stations, but hold it still while one is being dragged.
  const pad = 16;
  const xs = nodes.flatMap((p) => [p.x - p.w / 2, p.x + p.w / 2]);
  const ys = nodes.flatMap((p) => [p.y - NODE_H / 2, p.y + NODE_H / 2]);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const fitted = `${minX} ${minY} ${Math.max(...xs) + pad - minX} ${Math.max(...ys) + pad - minY}`;
  const box = dragging && frozen.current ? frozen.current : fitted;

  const toSvg = (e: React.PointerEvent): Point => {
    const m = svg.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const handlers = (i: number) => ({
    onPointerDown(e: React.PointerEvent<SVGGElement>) {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = {
        i,
        grab: toSvg(e),
        origin: { x: nodes[i].x, y: nodes[i].y },
        moved: false,
      };
    },
    onPointerMove(e: React.PointerEvent<SVGGElement>) {
      const d = drag.current;
      if (!d) return;
      const p = toSvg(e);
      const dx = p.x - d.grab.x;
      const dy = p.y - d.grab.y;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      if (!d.moved) frozen.current = fitted;
      d.moved = true;
      setDragging({ i, at: { x: d.origin.x + dx, y: d.origin.y + dy } });
    },
    onPointerUp() {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (!d.moved) return onSelect(stations[i].path);
      if (dragging) {
        const next = {
          ...placed,
          [stations[i].path]: {
            x: Math.round(dragging.at.x),
            y: Math.round(dragging.at.y),
          },
        };
        setPlaced(next);
        writePlaced(topicId, next);
      }
      setDragging(null);
      frozen.current = null;
    },
  });

  const here = stations.findIndex((s) => s.path === current);
  const pulse = usePulse(here >= 0, current);
  const focus = hover ?? (here >= 0 ? here : null);
  const near = new Set<number>();
  if (focus !== null)
    for (const e of edges)
      if (e.a === focus) near.add(e.b);
      else if (e.b === focus) near.add(e.a);

  if (!stations.length) return null;
  return (
    <div className={cn("group/graph relative h-full w-full", className)}>
      {Object.keys(placed).length > 0 && (
        <button
          type="button"
          onClick={() => {
            setPlaced({});
            writePlaced(topicId, {});
          }}
          title="清除拖动过的位置，恢复自动排布"
          className="absolute top-1 right-1 z-10 flex items-center gap-1 rounded-full border bg-popover px-2 py-0.5 text-[11px] text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/graph:opacity-100 hover:text-foreground focus-visible:opacity-100"
        >
          <LayoutGrid className="size-3" />
          重新排布
        </button>
      )}
      <svg
        ref={svg}
        viewBox={box}
        className="h-full w-full touch-none select-none"
        role="img"
        aria-label="主题结构图，可拖动站点"
      >
        <defs>
          <marker
            id={arrow}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" className="fill-subtle-foreground" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = nodes[e.a];
          const b = nodes[e.b];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const s = exit(a.w, dx, dy);
          const t = exit(b.w, -dx, -dy);
          const lit = focus !== null && (e.a === focus || e.b === focus);
          return (
            <line
              key={i}
              x1={a.x + s.x}
              y1={a.y + s.y}
              x2={b.x + t.x}
              y2={b.y + t.y}
              strokeDasharray={e.kind === "order" ? "3 3" : undefined}
              markerEnd={e.kind === "order" ? `url(#${arrow})` : undefined}
              className={cn(
                !dragging && "transition-opacity",
                e.kind === "link"
                  ? "stroke-muted-foreground"
                  : "stroke-subtle-foreground",
                focus !== null && !lit && "opacity-25",
              )}
              strokeWidth={lit ? 1.6 : 1}
            />
          );
        })}
        {stations.map((s, i) => {
          const p = nodes[i];
          const isHere = i === here;
          const seen = visited.includes(s.path);
          const dim = focus !== null && i !== focus && !near.has(i);
          const node = (
            <g
              transform={`translate(${p.x - p.w / 2} ${p.y - NODE_H / 2})`}
              {...handlers(i)}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className={cn(
                "cursor-pointer transition-opacity",
                dragging?.i === i && "cursor-grabbing",
                dim && "opacity-35",
              )}
            >
              {isHere && pulse && (
                <rect
                  width={p.w}
                  height={NODE_H}
                  rx={8}
                  className="svg-ripple fill-none stroke-emerald-500"
                  strokeWidth={2}
                />
              )}
              <g className={cn(isHere && pulse && "svg-pulse")}>
                <rect
                  width={p.w}
                  height={NODE_H}
                  rx={8}
                  className={cn(
                    isHere
                      ? "fill-emerald-600 stroke-emerald-600"
                      : seen
                        ? "fill-accent stroke-muted-foreground/50"
                        : "fill-popover stroke-border",
                    hover === i && !isHere && "stroke-foreground",
                  )}
                />
                <text
                  x={p.w / 2}
                  y={NODE_H / 2}
                  dominantBaseline="central"
                  textAnchor="middle"
                  className={cn(
                    "text-[11.5px]",
                    isHere ? "fill-white font-medium" : "fill-foreground",
                  )}
                >
                  {short(s.label)}
                </text>
              </g>
            </g>
          );
          // No hover card while dragging: it would trail behind the station.
          return (
            <FileHint
              key={`${s.path}-${i}`}
              disabled={Boolean(dragging)}
              hint={{ brief: splitPath(s.path).name, detail: s.description }}
              path={s.path}
              status=""
              meta={`${s.label} · 第 ${i + 1} 站${isHere ? " · 当前" : seen ? " · 已看过" : ""} · 可拖动`}
            >
              {node}
            </FileHint>
          );
        })}
      </svg>
    </div>
  );
}
