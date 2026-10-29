import { useMemo, useState } from "react";
import type { TopicStep } from "@shared/api";
import { FileHint } from "@/components/file-hint";
import { cn } from "@/lib/utils";

interface Edge {
  a: number;
  b: number;
  /** "order": next station in the reading order; "link": one explanation names the other file. */
  kind: "order" | "link";
}

const NODE_H = 26;
const width = (label: string) =>
  Math.min(132, 18 + [...short(label)].length * 11.5);
const short = (label: string) =>
  [...label].length > 9 ? [...label].slice(0, 8).join("") + "…" : label;

/**
 * Deterministic force layout (Fruchterman–Reingold, then a pass that pushes overlapping
 * boxes apart). Stations start on a circle in reading order, so the result is stable.
 */
function layout(labels: string[], edges: Edge[]) {
  const n = labels.length;
  const K = 120;
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

/**
 * The topic as a spread-out graph: stations are files, solid lines are relations named in the
 * explanations, dashed arrows are the reading order. Hovering a station lights up its neighbours.
 */
export function TopicGraph({
  stations,
  links,
  current,
  visited,
  onSelect,
  className,
}: {
  stations: TopicStep[];
  /** path → related topic files */
  links: Map<string, string[]>;
  current: string | null;
  visited: readonly string[];
  onSelect: (path: string) => void;
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { nodes, edges, box } = useMemo(() => {
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
    const nodes = layout(
      stations.map((s) => s.label),
      edges,
    );
    const pad = 16;
    const xs = nodes.flatMap((p) => [p.x - p.w / 2, p.x + p.w / 2]);
    const ys = nodes.flatMap((p) => [p.y - NODE_H / 2, p.y + NODE_H / 2]);
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    return {
      nodes,
      edges,
      box: `${minX} ${minY} ${Math.max(...xs) + pad - minX} ${Math.max(...ys) + pad - minY}`,
    };
  }, [stations, links]);

  const here = stations.findIndex((s) => s.path === current);
  const focus = hover ?? (here >= 0 ? here : null);
  const near = new Set<number>();
  if (focus !== null)
    for (const e of edges)
      if (e.a === focus) near.add(e.b);
      else if (e.b === focus) near.add(e.a);

  if (!stations.length) return null;
  return (
    <svg
      viewBox={box}
      className={cn("h-full w-full select-none", className)}
      role="img"
      aria-label="主题结构图"
    >
      <defs>
        <marker
          id="topic-graph-arrow"
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
            markerEnd={
              e.kind === "order" ? "url(#topic-graph-arrow)" : undefined
            }
            className={cn(
              "transition-opacity",
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
        return (
          <FileHint
            key={`${s.path}-${i}`}
            hint={{ brief: s.label, detail: s.description }}
            path={s.path}
            status={`第 ${i + 1} 站${isHere ? " · 当前" : seen ? " · 已看过" : ""}`}
          >
            <g
              transform={`translate(${p.x - p.w / 2} ${p.y - NODE_H / 2})`}
              onClick={() => onSelect(s.path)}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className={cn(
                "cursor-pointer transition-opacity",
                dim && "opacity-35",
              )}
            >
              <rect
                width={p.w}
                height={NODE_H}
                rx={8}
                className={cn(
                  isHere
                    ? "fill-foreground stroke-foreground"
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
                  isHere ? "fill-background font-medium" : "fill-foreground",
                )}
              >
                {short(s.label)}
              </text>
            </g>
          </FileHint>
        );
      })}
    </svg>
  );
}
