import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground",
        className,
      )}
    >
      <svg
        viewBox="0 0 32 32"
        className="size-[70%]"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 10l-5 6 5 6M21 10l5 6-5 6M17.5 8l-3 16" />
      </svg>
    </span>
  );
}
