import type { FileStatus } from "@shared/api";
import { cn } from "@/lib/utils";

export const fileStatusLabel: Record<FileStatus, string> = {
  fresh: "最新",
  stale: "已过期",
  missing: "未生成",
  unavailable: "无法读取",
};

const tone: Record<FileStatus, string> = {
  fresh: "bg-success",
  stale: "bg-warning",
  missing: "bg-transparent ring-1 ring-inset ring-subtle-foreground/60",
  unavailable: "bg-destructive",
};

export function StatusDot({
  status,
  className,
}: {
  status: FileStatus;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={fileStatusLabel[status]}
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone[status],
        className,
      )}
    />
  );
}
