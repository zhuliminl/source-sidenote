import type { ReactNode } from "react";
import {
  Check,
  CircleAlert,
  Copy,
  FileQuestion,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type { DocumentView, JobView } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InlineMarkdown } from "@/components/inline-markdown";
import { useDocument, useJobs, useRun } from "@/lib/queries";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LineRange } from "./code-viewer";

type Doc = Exclude<DocumentView, { status: "missing" }>;

/** The explanation for one file, designed to sit beside its source. */
export function ExplanationPanel({
  projectId,
  path,
  focus,
  onFocus,
  onNavigate,
}: {
  projectId: string;
  path: string;
  focus: LineRange | null;
  onFocus: (range: LineRange | null) => void;
  onNavigate: (path: string) => void;
}) {
  const doc = useDocument(projectId, path);
  const jobs = useJobs();
  const run = useRun();
  const forFile = jobs.data?.filter(
    (j) => j.project === projectId && j.path === path,
  );
  const activeJob = forFile?.find(
    (j) => j.state === "queued" || j.state === "running",
  );
  const lastJob = forFile?.[0];
  const busy = Boolean(activeJob) || run.isPending;
  const generate = () =>
    run.mutate({ project: projectId, kind: "generate", path });
  const review = () => run.mutate({ project: projectId, kind: "review", path });
  const data = doc.data?.status === "missing" ? undefined : doc.data;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
          <span className="text-sm font-medium">说明</span>
          {data && <Freshness doc={data} />}
          <div className="ml-auto flex items-center text-muted-foreground">
            {data && (
              <>
                <IconAction
                  label="复制 Markdown"
                  onClick={async () => {
                    await navigator.clipboard.writeText(data.markdown);
                    toast("已复制 Markdown");
                  }}
                >
                  <Copy />
                </IconAction>
                <IconAction
                  label="AI 复查这份说明"
                  onClick={review}
                  disabled={busy || data.status !== "fresh"}
                >
                  <ShieldCheck />
                </IconAction>
                <IconAction label="重新生成" onClick={generate} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                </IconAction>
              </>
            )}
          </div>
        </div>
      }
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-16 scrollbar-thin">
        {doc.isPending ? (
          <PanelSkeleton />
        ) : doc.isError ? (
          <Notice icon={<CircleAlert className="text-destructive" />}>
            {doc.error.message}
          </Notice>
        ) : !data ? (
          <Missing
            activeJob={activeJob}
            failure={lastJob?.state === "failed" ? lastJob : undefined}
            pending={run.isPending}
            onGenerate={generate}
          />
        ) : (
          <Body
            doc={data}
            regenerating={activeJob?.kind === "generate"}
            onRegenerate={generate}
            focus={focus}
            onFocus={onFocus}
            onNavigate={onNavigate}
          />
        )}
      </div>
    </div>
  );
}

function Freshness({ doc }: { doc: Doc }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        doc.status === "fresh" ? "text-success" : "text-warning",
      )}
      title={`${doc.model} · 生成于 ${new Date(doc.generated).toLocaleString()}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {doc.status === "fresh" ? "最新" : "已过期"}
    </span>
  );
}

function Body({
  doc,
  regenerating,
  onRegenerate,
  focus,
  onFocus,
  onNavigate,
}: {
  doc: Doc;
  regenerating: boolean;
  onRegenerate: () => void;
  focus: LineRange | null;
  onFocus: (range: LineRange | null) => void;
  onNavigate: (path: string) => void;
}) {
  const e = doc.explanation;
  return (
    <div className="text-sm leading-7">
      {doc.status === "stale" && (
        <Notice icon={<CircleAlert className="text-warning" />}>
          <span className="flex-1">
            源码、直接依赖或模型已变化，说明可能不准确。
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={onRegenerate}
            disabled={regenerating}
          >
            {regenerating ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            {regenerating ? "生成中" : "重新生成"}
          </Button>
        </Notice>
      )}

      <p className="text-[15px] leading-7 text-pretty">
        <InlineMarkdown>{e.summary}</InlineMarkdown>
      </p>
      <p className="mt-2 text-xs text-subtle-foreground">
        {doc.model} · {timeAgo(doc.generated)}
      </p>

      <List title="职责" items={e.responsibilities} />
      {e.flow.length > 0 && (
        <Section title="核心流程">
          <ol className="space-y-2">
            {e.flow.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <span>
                  <InlineMarkdown>{step}</InlineMarkdown>
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}
      <Section title="代码依据" hint="点击定位到代码">
        <ul className="-mx-2 space-y-0.5">
          {e.evidence.map((ev, i) => {
            const active = focus?.start === ev.start && focus.end === ev.end;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() =>
                    onFocus(active ? null : { start: ev.start, end: ev.end })
                  }
                  aria-pressed={active}
                  className={cn(
                    "flex w-full gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted",
                    active && "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1 h-fit shrink-0 rounded-md bg-muted px-1.5 font-mono text-[11px] leading-5 text-muted-foreground tabular-nums",
                      active && "bg-foreground text-background",
                    )}
                  >
                    L{ev.start}
                    {ev.end !== ev.start && `–${ev.end}`}
                  </span>
                  <span>
                    <InlineMarkdown>{ev.explanation}</InlineMarkdown>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
      {e.relations.length > 0 && (
        <Section title="关联文件">
          <ul className="-mx-2 space-y-0.5">
            {e.relations.map((r) => (
              <li key={r.path}>
                <button
                  type="button"
                  onClick={() => onNavigate(r.path)}
                  className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
                >
                  <span className="font-mono text-xs">{r.path}</span>
                  <span className="text-muted-foreground">
                    <InlineMarkdown>{r.description}</InlineMarkdown>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <List title="阅读注意" items={e.caveats} />
      <Review review={doc.review} />
    </div>
  );
}

function Review({ review }: { review: Doc["review"] }) {
  if (!review) return null;
  const pass = review.verdict === "pass";
  return (
    <Section title="AI 复查">
      <div className="rounded-xl border p-3">
        <p className="flex items-center gap-2 font-medium">
          {pass ? (
            <Check className="size-4 text-success" />
          ) : (
            <CircleAlert className="size-4 text-warning" />
          )}
          {pass ? "未发现事实错误" : `发现 ${review.issues.length} 个问题`}
          <span className="ml-auto text-xs font-normal text-subtle-foreground">
            {timeAgo(review.checked)}
          </span>
        </p>
        {!pass && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground marker:text-subtle-foreground">
            {review.issues.map((issue, i) => (
              <li key={i}>
                <InlineMarkdown>{issue}</InlineMarkdown>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-1.5 text-xs text-subtle-foreground">
        AI 复查通过不代表代码或说明一定正确。
      </p>
    </Section>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <Section title={title}>
      <ul className="list-disc space-y-1 pl-5 marker:text-subtle-foreground">
        {items.map((item, i) => (
          <li key={i}>
            <InlineMarkdown>{item}</InlineMarkdown>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-7">
      <h3 className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold">
        {title}
        {hint && (
          <span className="text-xs font-normal text-subtle-foreground">
            {hint}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

function IconAction({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & React.ComponentProps<"button">) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Notice({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-5 flex items-center gap-2.5 rounded-xl bg-muted px-3 py-2.5 text-[13px] leading-5 text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0">
      {icon}
      {children}
    </div>
  );
}

function Missing({
  activeJob,
  failure,
  pending,
  onGenerate,
}: {
  activeJob?: JobView;
  failure?: JobView;
  pending: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-col items-center pt-16 text-center">
      {activeJob ? (
        <>
          <Loader2 className="size-5 animate-spin text-subtle-foreground" />
          <p className="mt-4 text-sm font-medium">
            {activeJob.state === "running"
              ? "正在阅读代码并生成说明…"
              : "已在队列中等待"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">完成后自动显示</p>
        </>
      ) : (
        <>
          <FileQuestion className="size-5 text-subtle-foreground" />
          <p className="mt-4 text-sm font-medium">这个文件还没有说明</p>
          {failure?.error && (
            <p className="mt-1 max-w-xs text-xs text-destructive">
              上次失败：{failure.error}
            </p>
          )}
          <Button
            size="sm"
            className="mt-5"
            onClick={onGenerate}
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            生成说明
          </Button>
        </>
      )}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-full rounded-md" />
      <Skeleton className="h-4 w-4/5 rounded-md" />
      <Skeleton className="mt-8 h-3.5 w-16 rounded-md" />
      <Skeleton className="h-3.5 w-3/4 rounded-md" />
      <Skeleton className="h-3.5 w-2/3 rounded-md" />
    </div>
  );
}
