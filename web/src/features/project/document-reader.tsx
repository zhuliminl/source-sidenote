import type { ReactNode } from "react";
import {
  ArrowLeft,
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
import { splitPath, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

type Doc = Exclude<DocumentView, { status: "missing" }>;

export function DocumentReader({
  projectId,
  path,
  onNavigate,
}: {
  projectId: string;
  path: string;
  onNavigate: (path: string | null) => void;
}) {
  const doc = useDocument(projectId, path);
  const jobs = useJobs();
  const run = useRun();
  const activeJob = jobs.data?.find(
    (j) =>
      j.project === projectId &&
      j.path === path &&
      (j.state === "queued" || j.state === "running"),
  );
  const lastFailure = jobs.data?.find(
    (j) => j.project === projectId && j.path === path,
  );
  const generate = () =>
    run.mutate({ project: projectId, kind: "generate", path });
  const { dir, name } = splitPath(path);

  return (
    <article className="mx-auto w-full max-w-3xl px-6 pt-8 pb-24 md:px-10">
      <button
        type="button"
        onClick={() => onNavigate(null)}
        className="mb-6 -ml-1 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:hidden"
      >
        <ArrowLeft className="size-4" />
        文件列表
      </button>
      <p className="font-mono text-xs break-all text-subtle-foreground">
        {dir || "./"}
      </p>
      <div className="mt-1 flex items-start gap-3">
        <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight break-all">
          {name}
        </h1>
        {doc.data?.status !== "missing" && doc.data && (
          <ReaderActions
            doc={doc.data}
            busy={Boolean(activeJob) || run.isPending}
            onGenerate={generate}
            onReview={() =>
              run.mutate({ project: projectId, kind: "review", path })
            }
          />
        )}
      </div>

      {doc.isPending ? (
        <ReaderSkeleton />
      ) : doc.isError ? (
        <Notice icon={<CircleAlert className="text-destructive" />}>
          {doc.error.message}
        </Notice>
      ) : doc.data.status === "missing" ? (
        <MissingDocument
          activeJob={activeJob}
          failure={lastFailure?.state === "failed" ? lastFailure : undefined}
          pending={run.isPending}
          onGenerate={generate}
        />
      ) : (
        <Explanation
          doc={doc.data}
          regenerating={activeJob?.kind === "generate"}
          onRegenerate={generate}
          onNavigate={onNavigate}
        />
      )}
    </article>
  );
}

function ReaderActions({
  doc,
  busy,
  onGenerate,
  onReview,
}: {
  doc: Doc;
  busy: boolean;
  onGenerate: () => void;
  onReview: () => void;
}) {
  const copy = async () => {
    await navigator.clipboard.writeText(doc.markdown);
    toast("已复制 Markdown");
  };
  return (
    <div className="flex shrink-0 items-center gap-0.5 pt-0.5 text-muted-foreground">
      <IconAction label="复制 Markdown" onClick={copy}>
        <Copy />
      </IconAction>
      <IconAction
        label="AI 复查这份说明"
        onClick={onReview}
        disabled={busy || doc.status !== "fresh"}
      >
        <ShieldCheck />
      </IconAction>
      <IconAction label="重新生成" onClick={onGenerate} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      </IconAction>
    </div>
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

function Explanation({
  doc,
  regenerating,
  onRegenerate,
  onNavigate,
}: {
  doc: Doc;
  regenerating: boolean;
  onRegenerate: () => void;
  onNavigate: (path: string) => void;
}) {
  const e = doc.explanation;
  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle-foreground">
        <span
          className={cn(
            "inline-flex items-center gap-1.5",
            doc.status === "fresh" ? "text-success" : "text-warning",
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {doc.status === "fresh" ? "与当前代码一致" : "已过期"}
        </span>
        <span>{doc.model}</span>
        <span title={doc.generated}>生成于{timeAgo(doc.generated)}</span>
      </div>

      {doc.status === "stale" && (
        <Notice icon={<CircleAlert className="text-warning" />}>
          <span className="flex-1">
            源码或它的直接依赖已变化，这份说明可能不准确。
          </span>
          <Button
            size="sm"
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

      <p className="mt-8 text-[17px] leading-8 text-pretty">
        <InlineMarkdown>{e.summary}</InlineMarkdown>
      </p>

      <Section title="职责" items={e.responsibilities} />
      {e.flow.length > 0 && (
        <ReaderSection title="核心流程">
          <ol className="space-y-3">
            {e.flow.map((step, i) => (
              <li key={i} className="flex gap-3.5">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <span className="leading-7">
                  <InlineMarkdown>{step}</InlineMarkdown>
                </span>
              </li>
            ))}
          </ol>
        </ReaderSection>
      )}
      {e.relations.length > 0 && (
        <ReaderSection title="关联文件">
          <ul className="-mx-3 space-y-0.5">
            {e.relations.map((r) => (
              <li key={r.path}>
                <button
                  type="button"
                  onClick={() => onNavigate(r.path)}
                  className="flex w-full flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted"
                >
                  <span className="font-mono text-[13px]">{r.path}</span>
                  <span className="text-sm leading-6 text-muted-foreground">
                    <InlineMarkdown>{r.description}</InlineMarkdown>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </ReaderSection>
      )}
      <Section title="阅读注意" items={e.caveats} />
      <ReaderSection title="代码依据">
        <ul className="space-y-3">
          {e.evidence.map((ev, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 h-fit shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground tabular-nums">
                L{ev.start}
                {ev.end !== ev.start && `–${ev.end}`}
              </span>
              <span className="leading-7">
                <InlineMarkdown>{ev.explanation}</InlineMarkdown>
              </span>
            </li>
          ))}
        </ul>
      </ReaderSection>

      <ReviewSection review={doc.review} />
    </>
  );
}

function ReviewSection({ review }: { review: Doc["review"] }) {
  if (!review) return null;
  const pass = review.verdict === "pass";
  return (
    <ReaderSection title="AI 复查">
      <div className="rounded-2xl border p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          {pass ? (
            <Check className="size-4 text-success" />
          ) : (
            <CircleAlert className="size-4 text-warning" />
          )}
          {pass ? "未发现事实错误" : `发现 ${review.issues.length} 个问题`}
          <span className="ml-auto text-xs font-normal text-subtle-foreground">
            {review.model} · {timeAgo(review.checked)}
          </span>
        </p>
        {!pass && (
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground marker:text-subtle-foreground">
            {review.issues.map((issue, i) => (
              <li key={i}>
                <InlineMarkdown>{issue}</InlineMarkdown>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-2 text-xs text-subtle-foreground">
        AI 复查通过不代表代码或说明一定正确。
      </p>
    </ReaderSection>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <ReaderSection title={title}>
      <ul className="list-disc space-y-2 pl-5 leading-7 marker:text-subtle-foreground">
        {items.map((item, i) => (
          <li key={i} className="pl-1">
            <InlineMarkdown>{item}</InlineMarkdown>
          </li>
        ))}
      </ul>
    </ReaderSection>
  );
}

function ReaderSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Notice({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-6 flex items-center gap-3 rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0">
      {icon}
      {children}
    </div>
  );
}

function MissingDocument({
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
    <div className="mt-16 flex flex-col items-center text-center">
      {activeJob ? (
        <>
          <Loader2 className="size-6 animate-spin text-subtle-foreground" />
          <p className="mt-4 font-medium">
            {activeJob.state === "running"
              ? "正在阅读代码并生成说明…"
              : "已在队列中等待"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            完成后会自动显示，无需刷新。
          </p>
        </>
      ) : (
        <>
          <FileQuestion className="size-6 text-subtle-foreground" />
          <p className="mt-4 font-medium">这个文件还没有说明</p>
          {failure?.error && (
            <p className="mt-1 max-w-md text-sm text-destructive">
              上次失败：{failure.error}
            </p>
          )}
          <Button className="mt-6" onClick={onGenerate} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            生成说明
          </Button>
        </>
      )}
    </div>
  );
}

function ReaderSkeleton() {
  return (
    <div className="mt-8 space-y-4">
      <Skeleton className="h-4 w-1/3 rounded-md" />
      <Skeleton className="h-5 w-full rounded-md" />
      <Skeleton className="h-5 w-5/6 rounded-md" />
      <Skeleton className="mt-10 h-4 w-24 rounded-md" />
      <Skeleton className="h-4 w-3/4 rounded-md" />
      <Skeleton className="h-4 w-2/3 rounded-md" />
    </div>
  );
}
