import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUi } from "./ui-state";

export function SidebarToggle() {
  const { sidebarOpen, setSidebarOpen } = useUi();
  const label = sidebarOpen ? "收起侧边栏" : "打开侧边栏";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label={label}
          className="text-muted-foreground hover:text-foreground"
        >
          <PanelLeft className="size-[18px]" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
