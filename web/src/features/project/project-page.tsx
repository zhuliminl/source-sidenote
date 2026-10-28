import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { ArrowLeft, ChevronDown, Sparkles } from "lucide-react";
import type { ProjectSummary } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { PageHeader } from "@/components/layout/page-header";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useProjects, useRun } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ProjectActionsMenu } from "./project-actions";
import { FileTree } from "./file-tree";
import { CodeViewer, type LineRange } from "./code-viewer";
import { ExplanationPanel } from "./explanation-panel";
import { ProjectOverview } from "./project-overview";

function parseLines(value: string | null): LineRange | null {
  const m = value?.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const start = Number(m[1]);
  return { start, end: Math.max(start, Number(m[2] ?? m[1])) };
}

/** Reader state lives in the URL (?file=…&lines=12-30) so views can be linked and revisited. */
function useReaderState() {
  const [params, setParams] = useSearchParams();
  const file = params.get("file");
  const focus = parseLines(params.get("lines"));
  const select = (path: string | null) => setParams(path ? { file: path } : {});
  const setFocus = (range: LineRange | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (range)
          next.set(
            "lines",
            range.start === range.end
              ? `${range.start}`
              : `${range.start}-${range.end}`,
          );
        else next.delete("lines");
        return next;
      },
      { replace: true },
    );
  return { file, focus, select, setFocus };
}

export function ProjectPage() {
  const { projectId = "" } = useParams();
  const projects = useProjects();
  const project = projects.data?.find((p) => p.id === projectId);

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
  return <Reader key={project.id} project={project} />;
}

function Reader({ project }: { project: ProjectSummary }) {
  const run = useRun();
  const state = useReaderState();
  const wide = useMediaQuery("(min-width: 1100px)");
  const medium = useMediaQuery("(min-width: 768px)");
  const outdated = project.total - project.fresh;

  const tree = (className?: string) => (
    <FileTree
      projectId={project.id}
      selected={state.file}
      onSelect={state.select}
      className={className}
    />
  );
  const code = (file: string) => (
    <CodeViewer
      projectId={project.id}
      path={file}
      focus={state.focus}
      onFocus={state.setFocus}
    />
  );
  const explanation = (file: string) => (
    <ExplanationPanel
      projectId={project.id}
      path={file}
      focus={state.focus}
      onFocus={state.setFocus}
      onNavigate={state.select}
    />
  );

  return (
    <>
      <PageHeader>
        <ProjectActionsMenu project={project}>
          <button
            type="button"
            className="flex min-w-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-lg font-medium transition-colors hover:bg-accent data-[state=open]:bg-accent"
          >
            <span className="truncate">{project.name}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </ProjectActionsMenu>
        {outdated > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={run.isPending}
            onClick={() =>
              run.mutate({ project: project.id, kind: "generate" })
            }
          >
            <Sparkles />
            <span className="max-sm:sr-only">更新 {outdated} 个说明</span>
          </Button>
        )}
      </PageHeader>

      <div className="min-h-0 flex-1 border-t">
        {wide ? (
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel
              id="tree"
              defaultSize={264}
              minSize={180}
              maxSize={480}
            >
              {tree("h-full")}
            </ResizablePanel>
            <ResizableHandle />
            {state.file ? (
              <>
                <ResizablePanel id="code" minSize={360}>
                  {code(state.file)}
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel
                  id="explanation"
                  defaultSize={420}
                  minSize={300}
                  maxSize="55%"
                >
                  {explanation(state.file)}
                </ResizablePanel>
              </>
            ) : (
              <ResizablePanel id="overview">
                <Overview project={project} />
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        ) : (
          <div className="flex h-full">
            {(medium || !state.file) &&
              tree(
                cn(
                  "h-full shrink-0 border-r",
                  medium ? "w-60" : "w-full border-r-0",
                ),
              )}
            {state.file ? (
              <TabbedPanes
                focus={state.focus}
                key={state.file}
                onBack={medium ? undefined : () => state.select(null)}
                code={code(state.file)}
                explanation={explanation(state.file)}
              />
            ) : (
              medium && <Overview project={project} />
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Overview({ project }: { project: ProjectSummary }) {
  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto scrollbar-thin">
      <ProjectOverview project={project} />
    </div>
  );
}

/** Narrow screens: source and explanation share one pane, explanation first. */
function TabbedPanes({
  code,
  explanation,
  onBack,
  focus,
}: {
  code: React.ReactNode;
  explanation: React.ReactNode;
  onBack?: () => void;
  focus: LineRange | null;
}) {
  const [tab, setTab] = useState<"explanation" | "code">(
    focus ? "code" : "explanation",
  );
  // Following an evidence link should show the code it points at.
  const target = focus && `${focus.start}-${focus.end}`;
  useEffect(() => {
    if (target) setTab("code");
  }, [target]);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
        {onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="返回文件列表"
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
        )}
        <div
          className="flex rounded-full bg-muted p-0.5 text-sm"
          role="tablist"
        >
          {(
            [
              ["explanation", "说明"],
              ["code", "源码"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "rounded-full px-3.5 py-1 text-muted-foreground transition-colors",
                tab === value && "bg-background text-foreground shadow-sm",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "code" ? code : explanation}
      </div>
    </div>
  );
}
