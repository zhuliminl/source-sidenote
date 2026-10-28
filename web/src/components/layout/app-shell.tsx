import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLiveUpdates } from "@/hooks/use-live-updates";
import { useMediaQuery } from "@/hooks/use-media-query";
import { SettingsDialog } from "@/features/settings/settings-dialog";
import { cn } from "@/lib/utils";
import { Sidebar } from "./sidebar";
import { SidebarToggle } from "./sidebar-toggle";
import { UiContext, type SettingsTab, type UiState } from "./ui-state";

export function AppShell() {
  useLiveUpdates();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  const location = useLocation();
  const sidebarOpen = isMobile ? mobileOpen : desktopOpen;

  // On phones the sidebar is an overlay: close it after navigating.
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const ui = useMemo<UiState>(
    () => ({
      sidebarOpen,
      setSidebarOpen: isMobile ? setMobileOpen : setDesktopOpen,
      isMobile,
      openSettings: (tab = "model") => setSettings(tab),
    }),
    [sidebarOpen, isMobile],
  );

  return (
    <UiContext.Provider value={ui}>
      <div className="flex h-svh overflow-hidden">
        {isMobile && mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/30 animate-in fade-in-0"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <aside
          className={cn(
            "z-50 h-full shrink-0 overflow-hidden bg-sidebar transition-[width,transform] duration-200 ease-out",
            isMobile
              ? cn(
                  "fixed inset-y-0 left-0 w-[280px] shadow-xl",
                  mobileOpen ? "translate-x-0" : "-translate-x-full",
                )
              : desktopOpen
                ? "w-[260px] border-r border-sidebar-border"
                : "w-0",
          )}
        >
          <div className="h-full w-[260px] max-md:w-[280px]">
            <Sidebar />
          </div>
        </aside>
        <main className="relative flex min-w-0 flex-1 flex-col">
          {!sidebarOpen && <CollapsedControls />}
          <Outlet />
        </main>
      </div>
      <SettingsDialog
        tab={settings}
        onTabChange={setSettings}
        onOpenChange={(open) => !open && setSettings(null)}
      />
    </UiContext.Provider>
  );
}

/** When the sidebar is hidden, keep "open sidebar" and "new project" reachable. */
function CollapsedControls() {
  return (
    <div className="absolute top-2 left-2 z-10 flex items-center gap-0.5">
      <SidebarToggle />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" asChild>
            <Link to="/" aria-label="添加项目">
              <SquarePen className="size-[18px]" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>添加项目</TooltipContent>
      </Tooltip>
    </div>
  );
}
