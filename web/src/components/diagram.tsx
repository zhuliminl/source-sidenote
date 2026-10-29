import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

type Mermaid = typeof import("mermaid").default;
let loading: Promise<Mermaid> | undefined;
let configured: string | undefined;
// mermaid.render keeps global state, so renders run one at a time.
let queue: Promise<unknown> = Promise.resolve();

function render(code: string, id: string, theme: "light" | "dark") {
  loading ??= import("mermaid").then((m) => m.default);
  const job = queue.then(async () => {
    const mermaid = await loading!;
    if (configured !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: theme === "dark" ? "dark" : "neutral",
        fontFamily: "inherit",
        flowchart: { htmlLabels: false, curve: "basis" },
      });
      configured = theme;
    }
    const { svg } = await mermaid.render(id, code);
    return svg;
  });
  queue = job.catch(() => {});
  return job;
}

/** Width Mermaid laid the diagram out at; used to stop shrinking before text gets unreadable. */
function naturalWidth(svg: string) {
  const m = svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) [\d.]+"/);
  return m ? Math.round(Number(m[1])) : 600;
}

/** Mermaid flowchart nodes render as <g class="node" id="<svg>-flowchart-<id>-<n>">. */
function nodeId(el: Element) {
  return (
    el.getAttribute("data-id") ??
    el.id.match(/flowchart-(.+)-\d+$/)?.[1] ??
    null
  );
}

/**
 * Renders model-written Mermaid. Models sometimes emit invalid syntax; then the
 * source stays available behind a disclosure instead of breaking the page.
 */
export function Diagram({
  code,
  title,
  className,
  linked = [],
  active = [],
  onNodeClick,
  onNodeHover,
  linkHint,
}: {
  code: string;
  title: string;
  className?: string;
  /** Node ids that point at code (or files): they become clickable. */
  linked?: readonly string[];
  /** Node ids to highlight, e.g. the one covering the hovered code line. */
  active?: readonly string[];
  onNodeClick?: (node: string) => void;
  onNodeHover?: (node: string | null) => void;
  /** Tooltip for clickable nodes. */
  linkHint?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();
  const id = `d${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    render(code, id, resolved).then(
      (result) => !cancelled && setSvg(result),
      () => {
        // A failed render can leave an error element behind.
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, id, resolved]);

  // Mermaid's strict mode drops click handlers, so links are attached to the rendered SVG here.
  const linkedKey = linked.join(" ");
  const activeKey = active.join(" ");
  useEffect(() => {
    const root = box.current;
    if (!root || !svg) return;
    const links = new Set(linked);
    const on = new Set(active);
    for (const el of root.querySelectorAll("g.node")) {
      const id = nodeId(el);
      const isLinked = id !== null && links.has(id);
      el.classList.toggle("diagram-link", isLinked);
      el.classList.toggle("diagram-active", id !== null && on.has(id));
      if (isLinked && linkHint && !el.querySelector(":scope > title")) {
        const t = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "title",
        );
        t.textContent = linkHint;
        el.prepend(t);
      }
    }
    // Keyed by the ids, not the arrays, so re-renders with equal ids do not redo this.
  }, [svg, linkedKey, activeKey, linkHint]);

  const nodeFrom = (target: EventTarget) => {
    const el = (target as Element).closest?.("g.node");
    const id = el && nodeId(el);
    return id && linked.includes(id) ? id : null;
  };

  if (failed)
    return (
      <details
        className={cn("group text-xs text-subtle-foreground", className)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
          图表无法渲染，查看源码
        </summary>
        <pre className="mt-2 overflow-auto rounded-lg bg-muted p-3 font-mono whitespace-pre-wrap">
          {code}
        </pre>
      </details>
    );

  return (
    <>
      <figure
        className={cn(
          "group relative overflow-hidden rounded-xl border bg-card",
          className,
        )}
      >
        {svg ? (
          <div
            ref={box}
            onClick={(e) => {
              const id = nodeFrom(e.target);
              if (id) onNodeClick?.(id);
            }}
            onMouseOver={(e) => onNodeHover?.(nodeFrom(e.target))}
            onMouseLeave={() => onNodeHover?.(null)}
            className="diagram overflow-x-auto p-3 scrollbar-thin"
            style={
              {
                "--diagram-width": `${naturalWidth(svg)}px`,
              } as React.CSSProperties
            }
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="h-32 animate-pulse bg-muted/60" />
        )}
        {svg && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="放大查看"
            title="放大查看"
            className="absolute top-2 right-2 bg-card/80 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
            onClick={() => setZoomed(true)}
          >
            <Maximize2 />
          </Button>
        )}
      </figure>
      <Dialog open={zoomed} onOpenChange={setZoomed}>
        <DialogContent className="max-h-[92vh] w-[min(1100px,94vw)] max-w-none overflow-auto sm:max-w-none">
          <DialogTitle>{title}</DialogTitle>
          {svg && (
            <div
              className="diagram diagram-large flex justify-center"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
