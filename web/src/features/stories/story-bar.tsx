import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import type { StoryView } from "@shared/api";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRetryStory } from "@/lib/queries";
import { splitPath } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Light tints that tell files apart on the bar; a file keeps its tint for the whole story. */
const TINTS = [
  "bg-sky-300 dark:bg-sky-400/70",
  "bg-amber-300 dark:bg-amber-400/70",
  "bg-emerald-300 dark:bg-emerald-400/70",
  "bg-rose-300 dark:bg-rose-400/70",
  "bg-violet-300 dark:bg-violet-400/70",
  "bg-lime-300 dark:bg-lime-400/70",
  "bg-orange-300 dark:bg-orange-400/70",
  "bg-teal-300 dark:bg-teal-400/70",
  "bg-fuchsia-300 dark:bg-fuchsia-400/70",
  "bg-cyan-300 dark:bg-cyan-400/70",
];

/** How long autoplay stays on a step: enough to read its narration. */
const dwell = (text: string) => Math.min(14000, 3500 + [...text].length * 90);

/**
 * The story's "timeline", floating at the bottom of the reader: one segment per step, sized by
 * how much code it shows and tinted by file. Scrubbing it moves the reader to that step.
 */
export function StoryBar({
  story,
  step,
  onStep,
  onClose,
}: {
  story: StoryView;
  step: number;
  onStep: (index: number) => void;
  onClose: () => void;
}) {
  const retry = useRetryStory();
  const [playing, setPlaying] = useState(false);
  const steps = story.steps;
  const index = Math.min(step, Math.max(0, steps.length - 1));
  const current = steps[index];
  // The parent passes a new callback every render; timers read the latest one through a ref.
  const go = useRef(onStep);
  go.current = onStep;

  const tintOf = useMemo(() => {
    const order = new Map<string, number>();
    for (const s of steps)
      if (!order.has(s.path)) order.set(s.path, order.size);
    return (path: string) => TINTS[(order.get(path) ?? 0) % TINTS.length];
  }, [steps]);

  // Autoplay: dwell on each step long enough to read it, stop at the end.
  useEffect(() => {
    if (!playing || !current) return;
    if (index >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => go.current(index + 1), dwell(current.narration));
    return () => clearTimeout(t);
  }, [playing, index, current, steps.length]);

  // ← / → step through the story (ignored while typing).
  useEffect(() => {
    if (story.state !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const target = e.target as Partial<Element> | null;
      if (
        target?.closest?.(
          "input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=dialog]",
        )
      )
        return;
      if (e.key === "ArrowRight" && index < steps.length - 1) {
        e.preventDefault();
        go.current(index + 1);
      } else if (e.key === "ArrowLeft" && index > 0) {
        e.preventDefault();
        go.current(index - 1);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [story.state, index, steps.length]);

  const shell =
    "absolute bottom-4 left-1/2 z-30 w-[min(860px,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border bg-popover/95 shadow-xl backdrop-blur";

  if (story.state !== "ready" || !current)
    return (
      <div
        className={cn(shell, "flex items-center gap-3 px-4 py-3 text-sm")}
        role="status"
      >
        {story.state === "generating" ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <Clapperboard className="size-4 text-destructive" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{story.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {story.state === "generating"
              ? "AI 正在按这个问题录制故事，录好后这里会变成进度条…"
              : `录制失败：${story.error ?? "未知原因"}`}
          </span>
        </span>
        {story.state === "failed" && (
          <Button
            size="sm"
            variant="outline"
            disabled={retry.isPending}
            onClick={() => retry.mutate(story.id)}
          >
            <RefreshCw />
            重新录制
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="关闭故事"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
    );

  return (
    <section
      aria-label={`故事：${story.title}`}
      className={cn(shell, "px-4 pt-3 pb-3")}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2 text-sm">
            <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">
              {index + 1}/{steps.length}
            </span>
            <span className="truncate font-medium">{current.title}</span>
            <span className="ml-auto shrink-0 truncate font-mono text-[11px] text-subtle-foreground">
              {splitPath(current.path).name} · L{current.start}
              {current.end !== current.start && `–${current.end}`}
            </span>
          </p>
          <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
            {current.narration}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="上一步"
            title="上一步（←）"
            disabled={index <= 0}
            onClick={() => onStep(index - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label={playing ? "暂停" : "自动播放"}
            title={playing ? "暂停" : "自动播放"}
            onClick={() => {
              if (!playing && index >= steps.length - 1) onStep(0);
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="下一步"
            title="下一步（→）"
            disabled={index >= steps.length - 1}
            onClick={() => onStep(index + 1)}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="关闭故事"
            title="关闭故事"
            onClick={onClose}
            className="text-muted-foreground"
          >
            <X />
          </Button>
        </div>
      </div>

      {/* The timeline: |||| segments, wider for longer stretches of code, tinted per file. */}
      <div className="mt-2.5 flex h-4 items-center gap-0.5" role="list">
        {steps.map((s, i) => {
          const newFile = i > 0 && steps[i - 1].path !== s.path;
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="listitem"
                  aria-label={`第 ${i + 1} 步：${s.title}`}
                  aria-current={i === index ? "step" : undefined}
                  onClick={() => onStep(i)}
                  style={{
                    flexGrow: Math.min(60, Math.max(8, s.end - s.start + 1)),
                  }}
                  className={cn(
                    "h-2.5 min-w-2 basis-0 rounded-[3px] transition-all hover:h-4",
                    tintOf(s.path),
                    newFile && "ml-1",
                    i === index
                      ? "h-4 ring-2 ring-foreground/70 ring-offset-1 ring-offset-popover"
                      : i > index && "opacity-45",
                  )}
                />
              </TooltipTrigger>
              <TooltipContent side="top">
                {i + 1}. {s.title} · {splitPath(s.path).name}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </section>
  );
}
