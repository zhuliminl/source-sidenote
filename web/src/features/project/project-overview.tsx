import { AlertTriangle, FileText } from "lucide-react";
import type { ProjectSummary } from "@shared/api";
import { percent } from "@/lib/format";

/** Shown when no file is selected: what share of the project is explained and current. */
export function ProjectOverview({ project }: { project: ProjectSummary }) {
  const metrics = [
    {
      label: "覆盖率",
      hint: "已有说明的文件",
      count: project.covered,
      total: project.total,
    },
    {
      label: "新鲜率",
      hint: "说明与当前代码一致",
      count: project.fresh,
      total: project.covered,
    },
    {
      label: "复查通过",
      hint: "AI 复查通过，不等于正确",
      count: project.reviewed,
      total: project.total,
    },
  ];
  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-12">
      <div className="mb-10 space-y-2">
        <FileText className="size-6 text-subtle-foreground" />
        <h2 className="text-2xl font-medium tracking-tight">
          选择一个文件开始阅读
        </h2>
        <p className="font-mono text-xs break-all text-subtle-foreground">
          {project.root}
        </p>
      </div>
      <dl className="grid gap-8 sm:grid-cols-3">
        {metrics.map((m) => (
          <div key={m.label} className="space-y-2">
            <dt className="text-sm text-muted-foreground">{m.label}</dt>
            <dd className="text-3xl font-light tabular-nums">
              {percent(m.count, m.total)}
            </dd>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/80 transition-[width] duration-500"
                style={{ width: m.total ? `${(m.count / m.total) * 100}%` : 0 }}
              />
            </div>
            <dd className="text-xs text-subtle-foreground tabular-nums">
              {m.count} / {m.total} · {m.hint}
            </dd>
          </div>
        ))}
      </dl>
      {project.unavailable && (
        <p className="mt-10 flex items-center gap-2 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          部分已说明的文件无法从磁盘读取，可能已被移动或删除。重新扫描后更新。
        </p>
      )}
    </div>
  );
}
