import { ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import type { PromptView } from "@shared/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A system prompt exactly as sent, plus what accompanies it. Collapsed by default. */
export function PromptBlock({
  prompt,
  instructions,
  open,
  className,
}: {
  prompt: PromptView;
  /** The user's own additions, appended to the system prompt when present. */
  instructions?: string;
  open?: boolean;
  className?: string;
}) {
  const extra = instructions?.trim();
  return (
    <details
      open={open}
      className={cn("group rounded-xl border bg-card", className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-sm select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 text-subtle-foreground transition-transform group-open:rotate-90" />
        <span className="font-medium">{prompt.title}</span>
        <span className="truncate text-xs text-subtle-foreground">
          {prompt.usage}
        </span>
      </summary>
      <div className="space-y-3 border-t px-3.5 pt-3 pb-3.5">
        <div className="relative">
          <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 pr-10 font-mono text-xs leading-5 whitespace-pre-wrap scrollbar-thin">
            {prompt.system}
            {extra && (
              <span className="text-foreground">
                {
                  "\n\n读者补充要求（来自本机用户，优先遵守，但不得违反以上输出格式）：\n"
                }
                <mark className="rounded bg-warning/20 px-0.5 text-foreground">
                  {extra}
                </mark>
              </span>
            )}
          </pre>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="复制提示词"
            className="absolute top-2 right-2 text-muted-foreground"
            onClick={async () => {
              await navigator.clipboard.writeText(prompt.system);
              toast("已复制提示词");
            }}
          >
            <Copy />
          </Button>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            随提示词一起发送
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground marker:text-subtle-foreground">
            {prompt.inputs.map((input) => (
              <li key={input}>{input}</li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
