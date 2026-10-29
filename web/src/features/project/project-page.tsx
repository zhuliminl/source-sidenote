import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  FolderTree,
  Layers,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { ProjectSummary, TopicView as Topic } from "@shared/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { PageHeader } from "@/components/layout/page-header";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  useJobs,
  useProjects,
  useRefreshTopic,
  useTopic,
  useTopics,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ProjectActionsMenu } from "./project-actions";
import { FileTree } from "./file-tree";
import { CodeViewer } from "./code-viewer";
import { ReaderLinkProvider, type LineRange } from "./reader-link";
import { ExplanationPanel } from "./explanation-panel";
import { ProjectOverview, topicStateLabel } from "./project-overview";
import { TopicView } from "../topics/topic-view";
import { TopicMinimap } from "../topics/topic-minimap";
import { CreateTopicDialog } from "../topics/create-topic-dialog";

function parseLines(value: string | null): LineRange | null {
  const m = value?.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const start = Number(m[1]);
  return { start, end: Math.max(start, Number(m[2] ?? m[1])) };
}

/** Reader state lives in the URL (?topic=…&file=…&lines=12-30) so views can be linked and revisited. */
function useReaderState() {
  const [params, setParams] = useSearchParams();
  const topic = params.get("topic");
  const file = params.get("file");
  const focus = parseLines(params.get("lines"));
  const select = (path: string | null) =>
    setParams({
      ...(topic ? { topic } : {}),
      ...(path ? { file: path } : {}),
    });
  // Switching topics keeps the open file, so the same code can be read through another topic.
  const selectTopic = (id: string | null, keepFile = true) =>
    setParams({
      ...(id ? { topic: id } : {}),
      ...(keepFile && file ? { file } : {}),
    });
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
  return { topic, file, focus, select, selectTopic, setFocus };
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
  const state = useReaderState();
  const topics = useTopics(project.id);
  const topicQuery = useTopic(state.topic);
  const topic = topicQuery.data ?? null;
  const [creating, setCreating] = useState(false);
  const wide = useMediaQuery("(min-width: 1100px)");
  const medium = useMediaQuery("(min-width: 768px)");

  // A deleted or unknown topic in the URL falls back to the project view.
  const missingTopic = state.topic && topicQuery.isError;
  useEffect(() => {
    if (missingTopic) state.selectTopic(null);
    // Only react to the topic disappearing, not to every URL change.
  }, [missingTopic]);

  const tree = (className?: string) => (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <FileTree
        projectId={project.id}
        topic={topic}
        selected={state.file}
        onSelect={state.select}
        className="min-h-0 flex-1"
      />
    </div>
  );
  const code = (file: string) => (
    <CodeViewer
      projectId={project.id}
      topicId={topic?.state === "confirmed" ? topic.id : null}
      path={file}
      focus={state.focus}
      onFocus={state.setFocus}
    />
  );
  const explanation = (file: string) => (
    <ExplanationPanel
      projectId={project.id}
      topic={topic}
      path={file}
      focus={state.focus}
      onFocus={state.setFocus}
      onNavigate={state.select}
      onSelectTopic={(id) => state.selectTopic(id)}
      onCreateTopic={() => setCreating(true)}
    />
  );
  const home = () =>
    topic ? (
      <TopicView
        key={topic.id}
        topic={topic}
        onOpenFile={state.select}
        onDeleted={() => state.selectTopic(null, false)}
      />
    ) : (
      <Overview>
        <ProjectOverview
          project={project}
          topics={topics.data}
          onSelectTopic={(id) => state.selectTopic(id, false)}
          onCreateTopic={() => setCreating(true)}
        />
      </Overview>
    );

  return (
    <ReaderLinkProvider>
      <PageHeader>
        <ProjectActionsMenu project={project}>
          <button
            type="button"
            className="flex min-w-0 shrink items-center gap-1 rounded-lg px-2.5 py-1.5 text-lg font-medium transition-colors hover:bg-accent data-[state=open]:bg-accent"
          >
            <span className="truncate">{project.name}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </ProjectActionsMenu>
        <span className="text-subtle-foreground">/</span>
        <TopicMenu
          project={project.id}
          current={topic}
          onSelect={(id) => state.selectTopic(id, Boolean(id))}
          onCreate={() => setCreating(true)}
        />
        <div className="ml-auto flex items-center gap-2">
          {topic && state.file && (
            <Button
              size="sm"
              variant="ghost"
              className="max-sm:hidden"
              onClick={() => state.select(null)}
            >
              <Layers />
              主题概览
            </Button>
          )}
          {topic ? <TopicRefresh topic={topic} /> : null}
          {!topic && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreating(true)}
            >
              <Plus />
              <span className="max-sm:sr-only">新建主题</span>
            </Button>
          )}
        </div>
      </PageHeader>

      {/* The topic map floats above everything (fixed, draggable); it is mounted here for its data. */}
      <div className="relative min-h-0 flex-1 border-t">
        {topic?.state === "confirmed" && medium && (
          <TopicMinimap
            topic={topic}
            current={state.file}
            onSelect={state.select}
          />
        )}
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
              <ResizablePanel id="overview">{home()}</ResizablePanel>
            )}
          </ResizablePanelGroup>
        ) : (
          <div className="flex h-full">
            {medium && tree("h-full w-60 shrink-0 border-r")}
            {state.file ? (
              <TabbedPanes
                focus={state.focus}
                key={state.file}
                onBack={medium ? undefined : () => state.select(null)}
                code={code(state.file)}
                explanation={explanation(state.file)}
              />
            ) : (
              home()
            )}
          </div>
        )}
      </div>
      <CreateTopicDialog
        project={project.id}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => state.selectTopic(id, false)}
      />
    </ReaderLinkProvider>
  );
}

function TopicMenu({
  project,
  current,
  onSelect,
  onCreate,
}: {
  project: string;
  current: Topic | null;
  onSelect: (topic: string | null) => void;
  onCreate: () => void;
}) {
  const topics = useTopics(project);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 shrink items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[15px] transition-colors hover:bg-accent data-[state=open]:bg-accent"
        >
          {current ? (
            <Layers className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <FolderTree className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="max-w-[28ch] truncate">
            {current?.title ?? "全部文件"}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuItem onSelect={() => onSelect(null)}>
          <FolderTree />
          全部文件与覆盖率
          {!current && <Check className="ml-auto" />}
        </DropdownMenuItem>
        {topics.data && topics.data.length > 0 && <DropdownMenuSeparator />}
        {topics.data?.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => onSelect(t.id)}>
            <Layers />
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            {t.id === current?.id ? (
              <Check className="ml-auto" />
            ) : (
              t.state !== "confirmed" && (
                <span className="ml-auto text-xs text-subtle-foreground">
                  {topicStateLabel[t.state]}
                </span>
              )
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreate}>
          <Plus />
          新建主题
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Topic-level update: only offered when something is missing or outdated and nothing is running. */
function TopicRefresh({ topic }: { topic: Topic }) {
  const refresh = useRefreshTopic();
  const jobs = useJobs();
  if (topic.state !== "confirmed") return null;
  const running = jobs.data?.some(
    (j) =>
      j.topic === topic.id && (j.state === "queued" || j.state === "running"),
  );
  const outdated = topic.files - topic.fresh;
  if (running || outdated === 0) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={refresh.isPending}
      onClick={() => refresh.mutate(topic.id)}
    >
      <RefreshCw />
      <span className="max-sm:sr-only">更新 {outdated} 份说明</span>
    </Button>
  );
}

function Overview({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto scrollbar-thin">
      {children}
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
