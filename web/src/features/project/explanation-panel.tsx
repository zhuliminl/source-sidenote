import { useEffect, useRef, type ReactNode } from "react";
import {
  Check,
  CircleAlert,
  Copy,
  FileQuestion,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type { DocumentView, JobView, TopicView } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InlineMarkdown } from "@/components/inline-markdown";
import { Diagram } from "@/components/diagram";
import {
  useDocument,
  useFiles,
  useJobs,
  useRunFile,
  useTopics,
} from "@/lib/queries";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  narrowest,
  useHoverLine,
  useLinkSetters,
  type LineRange,
} from "./reader-link";
import { scrollParent } from "@/hooks/reveal";

type Doc = Exclude<DocumentView, { status: "missing" }>;

/** The explanation for one file within the current topic, designed to sit beside its source. */
export function ExplanationPanel({
  projectId,
  topic,
  path,
  focus,
  onFocus,
  onNavigate,
  onSelectTopic,
  onCreateTopic,
}: {
  projectId: string;
  topic: TopicView | null;
  path: string;
  focus: LineRange | null;
  onFocus: (range: LineRange | null) => void;
  onNavigate: (path: string) => void;
  onSelectTopic: (topic: string) => void;
  onCreateTopic: () => void;
}) {
  const inTopic =
    topic?.state === "confirmed" && topic.entries.some((e) => e.path === path);
  if (!inTopic)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-11 shrink-0 items-center border-b px-4">
          <span className="text-sm font-medium">说明</span>
        </div>
        <TopicChooser
          projectId={projectId}
          current={topic}
          path={path}
          onSelectTopic={onSelectTopic}
          onCreateTopic={onCreateTopic}
        />
      </div>
    );
  return (
    <TopicExplanation
      topic={topic!}
      path={path}
      focus={focus}
      onFocus={onFocus}
      onNavigate={onNavigate}
    />
  );
}

/** A file can be explained by several topics, or none yet. */
function TopicChooser({
  projectId,
  current,
  path,
  onSelectTopic,
  onCreateTopic,
}: {
  projectId: string;
  current: TopicView | null;
  path: string;
  onSelectTopic: (topic: string) => void;
  onCreateTopic: () => void;
}) {
  const files = useFiles(projectId);
  const topics = useTopics(projectId);
  const ids = files.data?.find((f) => f.path === path)?.topics ?? [];
  const covering = (topics.data ?? []).filter(
    (t) => ids.includes(t.id) && t.id !== current?.id,
  );
  const pending =
    current && current.state !== "confirmed"
      ? current.entries.some((e) => e.path === path)
      : false;
  return (
    <div className="flex flex-col items-center px-6 pt-16 text-center">
      <Layers className="size-5 text-subtle-foreground" />
      <p className="mt-4 text-sm font-medium">
        {pending
          ? "主题尚未确认"
          : current
            ? "这个文件不在当前主题中"
            : ids.length
              ? "选择一个主题查看说明"
              : "还没有主题覆盖这个文件"}
      </p>
      <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
        {pending
          ? "确认文件清单后才会生成说明。"
          : "说明按主题生成：同一个文件在不同主题里，会围绕不同的链路来解释。"}
      </p>
      {covering.length > 0 && (
        <ul className="mt-5 w-full max-w-xs space-y-1">
          {covering.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelectTopic(t.id)}
                className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              >
                <Layers className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{t.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button
        size="sm"
        variant="outline"
        className="mt-5"
        onClick={onCreateTopic}
      >
        <Plus />
        新建主题
      </Button>
    </div>
  );
}

function TopicExplanation({
  topic,
  path,
  focus,
  onFocus,
  onNavigate,
}: {
  topic: TopicView;
  path: string;
  focus: LineRange | null;
  onFocus: (range: LineRange | null) => void;
  onNavigate: (path: string) => void;
}) {
  const doc = useDocument(topic.id, path);
  const jobs = useJobs();
  const run = useRunFile();
  const forFile = jobs.data?.filter(
    (j) => j.topic === topic.id && j.path === path,
  );
  const activeJob = forFile?.find(
    (j) => j.state === "queued" || j.state === "running",
  );
  const lastJob = forFile?.[0];
  const busy = Boolean(activeJob) || run.isPending;
  const generate = () =>
    run.mutate({ topic: topic.id, path, kind: "generate" });
  const review = () => run.mutate({ topic: topic.id, path, kind: "review" });
  const data = doc.data?.status === "missing" ? undefined : doc.data;
  const reason = topic.entries.find((e) => e.path === path)?.reason;

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
      {/* Extra room at the bottom so even the last evidence entries can line up with their code. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-[45vh] scrollbar-thin">
        {reason && (
          <p className="mb-4 flex gap-2 text-xs leading-5 text-subtle-foreground">
            <Layers className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="text-muted-foreground">{topic.title}</span> ·{" "}
              {reason}
            </span>
          </p>
        )}
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
  const hoverLine = useHoverLine();
  const { setPeek } = useLinkSetters();
  const links = e.diagramLinks ?? [];
  // What the reader points at in the code: the hovered line, else the focused block.
  const line = hoverLine ?? focus?.start ?? null;
  const matched =
    hoverLine !== null
      ? narrowest(e.evidence, hoverLine)
      : e.evidence.find(
          (ev) => focus && ev.start === focus.start && ev.end === focus.end,
        );
  const node = narrowest(links, line);
  const list = useRef<HTMLUListElement>(null);
  // Do not leave code highlighted after switching files mid-hover.
  useEffect(() => () => setPeek(null), [setPeek]);

  // Strict alignment: while the mouse is on a block of code, scroll this panel so the matching
  // evidence starts at the same height as the block, and keep it there as the code scrolls.
  const following = hoverLine !== null ? matched : undefined;
  useEffect(() => {
    if (!following) return;
    const i = e.evidence.indexOf(following);
    const code = document.querySelector<HTMLElement>("[data-code-scroll]");
    const align = (behavior: ScrollBehavior) => {
      const entry = list.current?.querySelector(`[data-evidence="${i}"]`);
      const first = code?.querySelector(`[data-line="${following.start}"]`);
      const panel = entry && scrollParent(entry);
      if (!entry || !first || !code || !panel) return;
      // A block that starts above the visible code lines up with the top of the code instead.
      const top = Math.max(
        first.getBoundingClientRect().top,
        code.getBoundingClientRect().top,
      );
      panel.scrollTo({
        top: panel.scrollTop + entry.getBoundingClientRect().top - top,
        behavior,
      });
    };
    align("smooth");
    const onScroll = () => align("auto");
    code?.addEventListener("scroll", onScroll, { passive: true });
    return () => code?.removeEventListener("scroll", onScroll);
  }, [following, e.evidence]);

  const rangeOf = (id: string | null) => {
    const l = id ? links.find((x) => x.node === id) : undefined;
    return l ? { start: l.start, end: l.end } : null;
  };

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
      {e.why && (
        <p className="mt-2 text-muted-foreground text-pretty">
          <InlineMarkdown>{e.why}</InlineMarkdown>
        </p>
      )}
      <p className="mt-2 text-xs text-subtle-foreground">
        {doc.model} · {timeAgo(doc.generated)}
      </p>
      {e.diagram && (
        <Diagram
          code={e.diagram}
          title={doc.path}
          className="mt-5"
          linked={links.map((l) => l.node)}
          active={node ? [node.node] : []}
          onNodeClick={(id) => onFocus(rangeOf(id))}
          onNodeHover={(id) => setPeek(rangeOf(id))}
          linkHint="点击定位到代码"
        />
      )}

      {(e.scenario?.length ?? 0) > 0 && (
        <Section title="走一遍">
          <ol className="space-y-2">
            {e.scenario.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-warning/15 text-[11px] text-muted-foreground tabular-nums">
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
      <List title="职责" items={e.responsibilities} />
      {(e.terms?.length ?? 0) > 0 && (
        <Section title="术语">
          <dl className="space-y-1.5">
            {e.terms.map((t) => (
              <div key={t.term}>
                <dt className="inline font-medium">{t.term}</dt>
                <dd className="inline text-muted-foreground">
                  ：<InlineMarkdown>{t.meaning}</InlineMarkdown>
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
      <Section
        title="代码依据"
        hint="点击定位到代码，鼠标停在代码上会自动对应到这里"
      >
        <ul ref={list} className="-mx-2 space-y-0.5">
          {e.evidence.map((ev, i) => {
            const active = focus?.start === ev.start && focus.end === ev.end;
            const linked = ev === matched;
            return (
              <li
                key={i}
                data-evidence={i}
                data-evidence-range={`${ev.start}-${ev.end}`}
              >
                <button
                  type="button"
                  onClick={() =>
                    onFocus(active ? null : { start: ev.start, end: ev.end })
                  }
                  onMouseEnter={() => setPeek({ start: ev.start, end: ev.end })}
                  onMouseLeave={() => setPeek(null)}
                  aria-pressed={active}
                  className={cn(
                    "flex w-full gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted",
                    (active || linked) && "bg-muted",
                    linked && "ring-1 ring-foreground/15",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1 h-fit shrink-0 rounded-md bg-muted px-1.5 font-mono text-[11px] leading-5 text-muted-foreground tabular-nums",
                      (active || linked) && "bg-foreground text-background",
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
