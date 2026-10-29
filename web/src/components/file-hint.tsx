import type { ReactElement } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { splitPath } from "@/lib/format";

/** What hovering a topic file says about it: a short name and a sentence. */
export interface Hint {
  brief: string;
  detail: string;
}

/** Wraps a file row so hovering it explains the file; rows without a hint keep the native title. */
export function FileHint({
  hint,
  path,
  status,
  children,
  side = "right",
}: {
  hint: Hint | undefined;
  path: string;
  status: string;
  children: ReactElement;
  side?: "right" | "top" | "left" | "bottom";
}) {
  if (!hint || (!hint.brief && !hint.detail)) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align="start"
        sideOffset={8}
        arrow={false}
        // A light card like the menus rather than the default dark tooltip.
        className="w-96 max-w-[calc(100vw-2rem)] space-y-1.5 rounded-xl border bg-popover px-4 py-3 text-left text-pretty text-popover-foreground shadow-lg"
      >
        {hint.brief && (
          <p className="text-sm leading-5 font-medium">{hint.brief}</p>
        )}
        {hint.detail && (
          <p className="text-[13px] leading-5 text-muted-foreground">
            {hint.detail}
          </p>
        )}
        <p className="truncate pt-0.5 font-mono text-[11px] text-subtle-foreground">
          {splitPath(path).name} · {status}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
