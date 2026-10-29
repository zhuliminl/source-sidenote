import { Link, NavLink, useMatch } from "react-router";
import {
  Ellipsis,
  ListChecks,
  ScrollText,
  Loader2,
  Settings,
  SquarePen,
} from "lucide-react";
import type { ProjectSummary } from "@shared/api";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/logo";
import { ProjectActionsMenu } from "@/features/project/project-actions";
import { useJobs, useProjects } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { SidebarToggle } from "./sidebar-toggle";
import { useUi } from "./ui-state";

const rowClass =
  "group/row flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent";

export function Sidebar() {
  const { openSettings } = useUi();
  const jobs = useJobs();
  const active = jobs.data?.filter(
    (j) => j.state === "queued" || j.state === "running",
  ).length;

  return (
    <nav aria-label="主导航" className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between px-3">
        <Link to="/" className="flex items-center gap-2 rounded-lg px-1.5 py-1">
          <Logo className="size-6 rounded-md" />
          <span className="text-[15px] font-semibold tracking-tight">
            源旁注
          </span>
        </Link>
        <SidebarToggle />
      </div>

      <div className="space-y-0.5 px-2">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            cn(rowClass, isActive && "bg-sidebar-accent")
          }
        >
          <SquarePen className="size-4" />
          添加项目
        </NavLink>
        <NavLink
          to="/jobs"
          className={({ isActive }) =>
            cn(rowClass, isActive && "bg-sidebar-accent")
          }
        >
          <ListChecks className="size-4" />
          任务
          {active ? (
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
              <Loader2 className="size-3 animate-spin" />
              {active}
            </span>
          ) : null}
        </NavLink>
        <NavLink
          to="/prompts"
          className={({ isActive }) =>
            cn(rowClass, isActive && "bg-sidebar-accent")
          }
        >
          <ScrollText className="size-4" />
          提示词
        </NavLink>
      </div>

      <div className="mt-5 px-4 pb-1.5 text-xs font-medium text-subtle-foreground">
        项目
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2">
        <ProjectList />
      </ScrollArea>

      <div className="border-t border-sidebar-border p-2">
        <button
          type="button"
          className={rowClass}
          onClick={() => openSettings("model")}
        >
          <Settings className="size-4" />
          设置
          <span className="ml-auto text-xs text-subtle-foreground">本机</span>
        </button>
      </div>
    </nav>
  );
}

function ProjectList() {
  const { data, isPending } = useProjects();
  if (isPending)
    return (
      <div className="space-y-2 px-2.5 py-1">
        {[70, 55, 80].map((w) => (
          <Skeleton
            key={w}
            className="h-4 rounded-md"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    );
  if (!data?.length)
    return (
      <p className="px-2.5 py-1 text-sm text-subtle-foreground">还没有项目</p>
    );
  return (
    <ul className="space-y-0.5 pb-2">
      {data.map((p) => (
        <ProjectRow key={p.id} project={p} />
      ))}
    </ul>
  );
}

function ProjectRow({ project }: { project: ProjectSummary }) {
  const active = useMatch(`/projects/${project.id}`);
  return (
    <li
      className={cn(rowClass, "relative pr-1", active && "bg-sidebar-accent")}
    >
      <Link
        to={`/projects/${project.id}`}
        className="min-w-0 flex-1 truncate py-2 after:absolute after:inset-0"
        title={project.root}
      >
        {project.name}
      </Link>
      {project.topics > 0 && (
        <span
          className="shrink-0 text-xs text-subtle-foreground tabular-nums group-hover/row:hidden"
          aria-label={`${project.topics} 个主题`}
        >
          {project.topics}
        </span>
      )}
      <ProjectActionsMenu project={project}>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${project.name} 的操作`}
          className={cn(
            "relative z-10 text-muted-foreground opacity-0 hover:bg-transparent hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100",
            "max-md:opacity-100",
          )}
        >
          <Ellipsis />
        </Button>
      </ProjectActionsMenu>
    </li>
  );
}
