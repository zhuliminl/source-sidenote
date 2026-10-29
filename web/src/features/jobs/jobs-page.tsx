import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Ban,
  CircleCheck,
  CircleX,
  Clock,
  ListChecks,
  Loader2,
  X,
} from "lucide-react";
import type { JobKind, JobState, JobView } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { useCancelJob, useJobs, useProjects } from "@/lib/queries";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const kindLabel: Record<JobKind, string> = {
  plan: "规划主题",
  generate: "生成说明",
  review: "复查",
  overview: "链路导读",
  story: "录制故事",
};

const states: Record<
  JobState,
  { label: string; icon: typeof Clock; className: string }
> = {
  queued: { label: "等待中", icon: Clock, className: "text-subtle-foreground" },
  running: {
    label: "进行中",
    icon: Loader2,
    className: "animate-spin text-foreground",
  },
  done: { label: "已完成", icon: CircleCheck, className: "text-success" },
  failed: { label: "失败", icon: CircleX, className: "text-destructive" },
  cancelled: {
    label: "已取消",
    icon: Ban,
    className: "text-subtle-foreground",
  },
};

type Filter = "all" | "active" | "failed";
const filters: [Filter, string][] = [
  ["all", "全部"],
  ["active", "进行中"],
  ["failed", "失败"],
];
const matches = (j: JobView, f: Filter) =>
  f === "all" ||
  (f === "active"
    ? j.state === "queued" || j.state === "running"
    : j.state === "failed");

export function JobsPage() {
  const jobs = useJobs();
  const projects = useProjects();
  const [filter, setFilter] = useState<Filter>("all");
  const names = useMemo(
    () => new Map(projects.data?.map((p) => [p.id, p.name])),
    [projects.data],
  );
  const visible = jobs.data?.filter((j) => matches(j, filter)) ?? [];

  return (
    <>
      <PageHeader>
        <h1 className="px-2.5 text-lg font-medium">任务</h1>
      </PageHeader>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-20 md:px-6">
          <div className="mb-4 flex items-center gap-1 text-sm" role="tablist">
            {filters.map(([value, label]) => {
              const count = jobs.data?.filter((j) => matches(j, value)).length;
              return (
                <button
                  key={value}
                  role="tab"
                  aria-selected={filter === value}
                  onClick={() => setFilter(value)}
                  className={cn(
                    "rounded-full px-3 py-1.5 transition-colors",
                    filter === value
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                  {value !== "all" && count ? (
                    <span className="ml-1.5 text-subtle-foreground tabular-nums">
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
            <span className="ml-auto text-xs text-subtle-foreground">
              最近 200 个
            </span>
          </div>

          {jobs.isPending ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : visible.length ? (
            <ul className="divide-y">
              {visible.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  projectName={names.get(job.project)}
                />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center py-24 text-center">
              <ListChecks className="size-6 text-subtle-foreground" />
              <p className="mt-4 font-medium">
                {filter === "all" ? "还没有任务" : "这里是空的"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                生成或复查说明后，进度会实时显示在这里。
              </p>
            </div>
          )}
          <p className="mt-8 text-center text-xs text-subtle-foreground">
            失败的任务不会自动重试；已有的有效说明会保留。
          </p>
        </div>
      </div>
    </>
  );
}

function JobRow({ job, projectName }: { job: JobView; projectName?: string }) {
  const cancel = useCancelJob();
  const state = states[job.state];
  const Icon = state.icon;
  const active = job.state === "queued" || job.state === "running";
  return (
    <li className="group flex items-start gap-3 py-3.5">
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", state.className)}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <Link
          to={`/projects/${job.project}?topic=${encodeURIComponent(job.topic)}${job.path ? `&file=${encodeURIComponent(job.path)}` : ""}`}
          className={cn(
            "block truncate text-[13px] hover:underline",
            job.path && "font-mono",
          )}
        >
          {job.path || (job.topicTitle ?? "已删除的主题")}
        </Link>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-subtle-foreground">
          <span>{projectName ?? "已移除的项目"}</span>
          {job.path && job.topicTitle && (
            <>
              <span>·</span>
              <span className="max-w-[16rem] truncate">{job.topicTitle}</span>
            </>
          )}
          <span>·</span>
          <span>{kindLabel[job.kind]}</span>
          <span>·</span>
          <span>{state.label}</span>
          <span>·</span>
          <span title={job.updated ?? job.created}>
            {timeAgo(job.updated ?? job.created)}
          </span>
          {job.attempts > 1 && <span>· 第 {job.attempts} 次</span>}
        </p>
        {job.error && (
          <p className="mt-1.5 text-xs leading-5 break-words text-destructive">
            {job.error}
          </p>
        )}
      </div>
      {active && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="取消任务"
          className="text-muted-foreground"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(job.id)}
        >
          <X />
        </Button>
      )}
    </li>
  );
}
