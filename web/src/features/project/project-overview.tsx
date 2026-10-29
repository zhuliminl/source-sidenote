import { ChevronRight, Layers, Loader2, Plus } from "lucide-react";
import type { ProjectSummary, TopicState, TopicSummary } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { percent, timeAgo } from "@/lib/format";

export const topicStateLabel: Record<TopicState, string> = {
  planning: "规划中",
  plan_failed: "规划失败",
  planned: "待确认",
  confirmed: "已确认",
};

/** Shown when neither a topic nor a file is selected: coverage and the project's topics. */
export function ProjectOverview({
  project,
  topics,
  onSelectTopic,
  onCreateTopic,
}: {
  project: ProjectSummary;
  topics: TopicSummary[] | undefined;
  onSelectTopic: (topic: string) => void;
  onCreateTopic: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="space-y-2">
        <Layers className="size-6 text-subtle-foreground" />
        <h2 className="text-2xl font-medium tracking-tight">
          从一个主题开始读
        </h2>
        <p className="text-[15px] leading-7 text-muted-foreground">
          不必解释整个项目。描述你想弄懂的功能或链路，AI
          会挑出相关文件，由你确认后再生成说明。
        </p>
        <p className="font-mono text-xs break-all text-subtle-foreground">
          {project.root}
        </p>
      </div>

      <div className="mt-8 flex items-end gap-8">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">覆盖率</p>
          <p className="text-3xl font-light tabular-nums">
            {percent(project.covered, project.total)}
          </p>
        </div>
        <div className="flex-1 space-y-2 pb-1.5">
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground/80 transition-[width] duration-500"
              style={{
                width: project.total
                  ? `${(project.covered / project.total) * 100}%`
                  : 0,
              }}
            />
          </div>
          <p className="text-xs text-subtle-foreground tabular-nums">
            {project.covered} / {project.total} 个文件至少被一个主题解释
          </p>
        </div>
      </div>

      <div className="mt-10 mb-3 flex items-center">
        <h3 className="text-[13px] font-semibold">
          主题{" "}
          <span className="font-normal text-subtle-foreground tabular-nums">
            {topics?.length ?? ""}
          </span>
        </h3>
        <Button size="sm" className="ml-auto" onClick={onCreateTopic}>
          <Plus />
          新建主题
        </Button>
      </div>
      {!topics ? (
        <Skeleton className="h-14 rounded-xl" />
      ) : topics.length ? (
        <ul className="divide-y rounded-xl border">
          {topics.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelectTopic(t.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle-foreground">
                    {t.state === "planning" && (
                      <Loader2 className="size-3 animate-spin" />
                    )}
                    {topicStateLabel[t.state]}
                    {t.state === "confirmed" &&
                      ` · ${t.fresh}/${t.files} 份说明最新`}
                    {t.state === "planned" && ` · ${t.files} 个文件`}
                    {` · ${timeAgo(t.created)}`}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-subtle-foreground" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <button
          type="button"
          onClick={onCreateTopic}
          className="w-full rounded-xl border border-dashed px-4 py-8 text-sm text-muted-foreground transition-colors hover:bg-muted"
        >
          还没有主题。比如：“一个请求从路由进来到写入数据库的完整链路”
        </button>
      )}
    </div>
  );
}
