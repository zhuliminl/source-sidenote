import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useUi } from "./ui-state";

/** Sticky 56px top bar; leaves room for the floating controls when the sidebar is hidden. */
export function PageHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { sidebarOpen } = useUi();
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-2 px-3",
        !sidebarOpen && "pl-[92px]",
        className,
      )}
    >
      {children}
    </header>
  );
}
