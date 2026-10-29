import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { tokenize, type ThemedToken } from "@/lib/highlight";
import { useDocument, useSource } from "@/lib/queries";
import { formatBytes, splitPath } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  narrowest,
  useLinkSetters,
  usePeek,
  type LineRange,
} from "./reader-link";

export type { LineRange };

export function CodeViewer({
  projectId,
  topicId,
  path,
  focus,
  onFocus,
}: {
  projectId: string;
  topicId: string | null;
  path: string;
  focus: LineRange | null;
  onFocus: (range: LineRange | null) => void;
}) {
  const source = useSource(projectId, path);
  // Lines the explanation covers get a gutter mark, so readers know hovering them leads somewhere.
  const doc = useDocument(topicId, path);
  const explained = useMemo(
    () =>
      doc.data && doc.data.status !== "missing"
        ? doc.data.explanation.evidence
        : [],
    [doc.data],
  );
  const content = source.data?.content;
  const lines = useMemo(() => content?.split("\n") ?? [], [content]);
  const tokens = useTokens(content, path);
  const { dir, name } = splitPath(path);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <p className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
          <span className="text-subtle-foreground">{dir}</span>
          <span className="font-medium">{name}</span>
        </p>
        {source.data && (
          <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">
            {lines.length} 行 · {formatBytes(source.data.bytes)}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="复制路径"
          className="text-muted-foreground"
          onClick={async () => {
            await navigator.clipboard.writeText(path);
            toast("已复制路径");
          }}
        >
          <Copy />
        </Button>
      </div>
      {source.isPending ? (
        <div className="space-y-2.5 p-5">
          {Array.from({ length: 14 }, (_, i) => (
            <Skeleton
              key={i}
              className="h-3.5 rounded"
              style={{ width: `${20 + ((i * 37) % 60)}%` }}
            />
          ))}
        </div>
      ) : source.isError ? (
        <p className="m-6 flex items-center gap-2 text-sm text-muted-foreground">
          <CircleAlert className="size-4 text-destructive" />
          {source.error.message}
        </p>
      ) : (
        <CodeLines
          lines={lines}
          tokens={tokens}
          focus={focus}
          onFocus={onFocus}
          explained={explained}
        />
      )}
    </div>
  );
}

function useTokens(content: string | undefined, path: string) {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  useEffect(() => {
    setTokens(null);
    if (content === undefined) return;
    let cancelled = false;
    // Plain text renders immediately; colours arrive once the grammar has loaded.
    tokenize(content, path)
      .then((t) => !cancelled && setTokens(t))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [content, path]);
  return tokens;
}

function CodeLines({
  lines,
  tokens,
  focus,
  onFocus,
  explained,
}: {
  lines: string[];
  tokens: ThemedToken[][] | null;
  focus: LineRange | null;
  onFocus: (range: LineRange | null) => void;
  explained: readonly LineRange[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const gutter = `calc(${String(lines.length).length}ch + 1.75rem)`;
  const { setHoverLine } = useLinkSetters();
  // The explained block under the mouse lights up as a whole, mirroring hovering it on the right.
  // Kept locally and only updated when the block changes, so moving within it does not re-render.
  const [block, setBlock] = useState<LineRange | null>(null);
  const hover = (line: number | null) => {
    setHoverLine(line);
    const next = narrowest(explained, line) ?? null;
    setBlock((prev) =>
      prev?.start === next?.start && prev?.end === next?.end ? prev : next,
    );
  };
  const peek = usePeek();
  const covered = useMemo(() => {
    const set = new Set<number>();
    for (const r of explained)
      for (let n = r.start; n <= r.end; n++) set.add(n);
    return set;
  }, [explained]);

  // A block focused from the explanation scrolls so its top lines up with that evidence entry.
  // Focus set by clicking the code itself (the mouse is on a block) leaves the code still.
  const hovering = useRef(false);
  hovering.current = block !== null;
  useEffect(() => {
    const box = container.current;
    if (!focus || !box || hovering.current) return;
    const el = box.querySelector(`[data-line="${focus.start}"]`);
    if (!el) return;
    const line = el.getBoundingClientRect();
    const entry = document.querySelector(
      `[data-evidence-range="${focus.start}-${focus.end}"]`,
    );
    if (entry) {
      box.scrollTo({
        top: box.scrollTop + line.top - entry.getBoundingClientRect().top,
        behavior: "smooth",
      });
      return;
    }
    const view = box.getBoundingClientRect();
    if (line.top < view.top || line.bottom > view.bottom)
      el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);

  /** Clicking code selects the whole explained block it belongs to (again: deselect). */
  const select = (n: number) => {
    const b = narrowest(explained, n);
    onFocus(
      !b || (focus && focus.start === b.start && focus.end === b.end)
        ? null
        : { start: b.start, end: b.end },
    );
  };

  const lineAt = (target: EventTarget) =>
    Number(
      (target as HTMLElement).closest<HTMLElement>("[data-line]")?.dataset
        .line ?? 0,
    ) || null;

  return (
    <div
      ref={container}
      onMouseOver={(e) => hover(lineAt(e.target))}
      onMouseLeave={() => hover(null)}
      onClick={(e) => {
        // A click on the code selects its block, unless the reader is selecting text to copy.
        if (window.getSelection()?.toString()) return;
        if ((e.target as HTMLElement).closest("button")) return;
        const n = lineAt(e.target);
        if (n) select(n);
      }}
      data-code-scroll
      className="min-h-0 flex-1 overflow-auto py-3 font-mono text-[12.5px] leading-[1.7] scrollbar-thin"
    >
      <div className="min-w-max">
        {lines.map((text, i) => {
          const n = i + 1;
          const active = focus && n >= focus.start && n <= focus.end;
          // One look for "this block is the one being explained", whichever side pointed at it.
          const lit =
            active ||
            (peek && n >= peek.start && n <= peek.end) ||
            (block && n >= block.start && n <= block.end);
          return (
            <div
              key={i}
              data-line={n}
              className={cn(
                "flex border-l-2 border-transparent pr-6",
                covered.has(n) && "border-foreground/12",
                lit && "border-foreground/50 bg-warning/10",
              )}
            >
              <button
                type="button"
                tabIndex={-1}
                onClick={() => select(n)}
                style={{ width: gutter }}
                className={cn(
                  "shrink-0 cursor-pointer pr-4 pl-3 text-right text-subtle-foreground/70 tabular-nums select-none hover:text-foreground",
                  active && "text-foreground",
                )}
              >
                {n}
              </button>
              <span className="whitespace-pre">
                {tokens?.[i]
                  ? tokens[i].map((t, j) => (
                      <span key={j} className="code-token" style={t.htmlStyle}>
                        {t.content}
                      </span>
                    ))
                  : text || " "}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
