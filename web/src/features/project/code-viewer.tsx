import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { tokenize, type ThemedToken } from "@/lib/highlight";
import { useSource } from "@/lib/queries";
import { formatBytes, splitPath } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface LineRange {
  start: number;
  end: number;
}

export function CodeViewer({
  projectId,
  path,
  focus,
  onFocus,
}: {
  projectId: string;
  path: string;
  focus: LineRange | null;
  onFocus: (range: LineRange | null) => void;
}) {
  const source = useSource(projectId, path);
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
}: {
  lines: string[];
  tokens: ThemedToken[][] | null;
  focus: LineRange | null;
  onFocus: (range: LineRange | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const gutter = `calc(${String(lines.length).length}ch + 1.75rem)`;

  useEffect(() => {
    if (!focus) return;
    container.current
      ?.querySelector(`[data-line="${focus.start}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);

  return (
    <div
      ref={container}
      className="min-h-0 flex-1 overflow-auto py-3 font-mono text-[12.5px] leading-[1.7] scrollbar-thin"
    >
      <div className="min-w-max">
        {lines.map((text, i) => {
          const n = i + 1;
          const active = focus && n >= focus.start && n <= focus.end;
          return (
            <div
              key={i}
              data-line={n}
              className={cn(
                "flex border-l-2 border-transparent pr-6",
                active && "border-foreground/50 bg-warning/10",
              )}
            >
              <button
                type="button"
                tabIndex={-1}
                onClick={() =>
                  onFocus(
                    active && focus.start === focus.end
                      ? null
                      : { start: n, end: n },
                  )
                }
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
