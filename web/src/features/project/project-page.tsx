import { useParams, useSearchParams } from "react-router";
import { ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { useProjects, useRun } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ProjectActionsMenu } from "./project-actions";
import { FileList } from "./file-list";
import { DocumentReader } from "./document-reader";
import { ProjectOverview } from "./project-overview";

export function ProjectPage() {
  const { projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const selected = params.get("file");
  const projects = useProjects();
  const run = useRun();
  const project = projects.data?.find((p) => p.id === projectId);

  const select = (path: string | null) =>
    setParams(path ? { file: path } : {}, { replace: false });

  if (projects.isPending)
    return (
      <PageHeader>
        <Skeleton className="h-6 w-40 rounded-md" />
      </PageHeader>
    );
  if (!project)
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        项目不存在或已被移除
      </div>
    );

  const outdated = project.total - project.fresh;

  return (
    <>
      <PageHeader className="border-b border-transparent">
        <ProjectActionsMenu project={project}>
          <button
            type="button"
            className="flex min-w-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-lg font-medium transition-colors hover:bg-accent data-[state=open]:bg-accent"
          >
            <span className="truncate">{project.name}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </ProjectActionsMenu>
        <div className="ml-auto flex items-center gap-3">
          {outdated > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={run.isPending}
              onClick={() =>
                run.mutate({ project: project.id, kind: "generate" })
              }
            >
              <Sparkles />
              <span className="max-sm:sr-only">更新 {outdated} 个说明</span>
            </Button>
          )}
        </div>
      </PageHeader>

      <div className="flex min-h-0 flex-1 border-t">
        <FileList
          projectId={project.id}
          selected={selected}
          onSelect={select}
          className={cn(
            "w-[300px] shrink-0 border-r max-md:w-full max-md:border-r-0",
            selected && "max-md:hidden",
          )}
        />
        <section
          className={cn(
            "min-w-0 flex-1 overflow-y-auto scrollbar-thin",
            !selected && "max-md:hidden",
          )}
        >
          {selected ? (
            <DocumentReader
              key={selected}
              projectId={project.id}
              path={selected}
              onNavigate={select}
            />
          ) : (
            <ProjectOverview project={project} />
          )}
        </section>
      </div>
    </>
  );
}
