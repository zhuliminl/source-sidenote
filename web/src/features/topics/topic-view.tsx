import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { ActiveModel, TopicFile, TopicView as Topic } from "@shared/api";
import { ModelSelect } from "@/components/model-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InlineMarkdown } from "@/components/inline-markdown";
import { Diagram } from "@/components/diagram";
import { PromptBlock } from "@/components/prompt-block";
import { StatusDot, fileStatusLabel } from "@/components/status-dot";
import {
  useConfig,
  useConfirmTopic,
  useFiles,
  useJobs,
  usePrompts,
  useRefreshTopic,
  useRemoveTopic,
  useReplan,
} from "@/lib/queries";
import { splitPath, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The topic itself, shown when no file is open: planning, confirmation, then the walkthrough. */
export function TopicView({
  topic,
  onOpenFile,
  onDeleted,
}: {
  topic: Topic;
  onOpenFile: (path: string) => void;
  onDeleted: () => void;
}) {
  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-3xl px-6 pt-8 pb-20">
        <header className="mb-8">
          <h2 className="text-2xl font-medium tracking-tight text-balance">
            {topic.title}
          </h2>
          <p className="mt-2 text-[15px] leading-7 text-muted-foreground">
            {topic.request}
          </p>
          <p className="mt-2 text-xs text-subtle-foreground">
            创建于 {timeAgo(topic.created)}
            {topic.model && ` · ${topic.model}`}
          </p>
        </header>
        {topic.state === "planning" && <Planning />}
        {topic.state === "plan_failed" && <PlanFailed topic={topic} />}
        {topic.state === "planned" && <PlanReview topic={topic} />}
        {topic.state === "confirmed" && (
          <Walkthrough topic={topic} onOpenFile={onOpenFile} />
        )}
        <DeleteTopic topic={topic} onDeleted={onDeleted} />
      </div>
    </div>
  );
}

function Planning() {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-muted px-4 py-4 text-sm">
      <Loader2 className="size-4 animate-spin text-subtle-foreground" />
      <div>
        <p className="font-medium">AI 正在阅读项目结构并挑选相关文件…</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          只发送文件路径和 README，不发送源码。完成后由你确认文件清单。
        </p>
      </div>
    </div>
  );
}

function PlanFailed({ topic }: { topic: Topic }) {
  const replan = useReplan();
  const config = useConfig();
  const [model, setModel] = useState<ActiveModel | null>(() =>
    topic.provider && topic.model
      ? { provider: topic.provider, model: topic.model }
      : null,
  );
  const choice = model ?? config.data?.active ?? null;
  return (
    <div className="rounded-xl border px-4 py-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <CircleAlert className="size-4 text-destructive" />
        规划失败
      </p>
      {topic.error && (
        <p className="mt-1.5 text-xs break-words text-muted-foreground">
          {topic.error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ModelSelect
          value={choice}
          onChange={setModel}
          className="h-8 w-auto max-w-full"
        />
        <Button
          size="sm"
          disabled={replan.isPending || !choice}
          onClick={() =>
            replan.mutate({
              topic: topic.id,
              ...(choice ? { model: choice } : {}),
            })
          }
        >
          <RefreshCw />
          重新规划
        </Button>
      </div>
    </div>
  );
}

/** The confirmation gate: nothing is sent with source code until the user agrees to this list. */
function PlanReview({ topic }: { topic: Topic }) {
  const [files, setFiles] = useState(() =>
    topic.entries.map(({ path, reason }) => ({ path, reason })),
  );
  const [instructions, setInstructions] = useState(topic.instructions);
  const config = useConfig();
  const [model, setModel] = useState<ActiveModel | null>(() =>
    topic.provider && topic.model
      ? { provider: topic.provider, model: topic.model }
      : null,
  );
  const choice = model ?? config.data?.active ?? null;
  const confirm = useConfirmTopic();
  const replan = useReplan();
  const prompts = usePrompts();
  const shown = prompts.data?.filter(
    (p) => p.id === "explain" || p.id === "overview",
  );

  const move = (i: number, by: number) =>
    setFiles((prev) => {
      const next = [...prev];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item);
      return next;
    });

  return (
    <div className="space-y-8">
      {topic.plan && (
        <section>
          <SectionTitle>AI 的规划</SectionTitle>
          <p className="text-sm leading-7">
            <InlineMarkdown>{topic.plan}</InlineMarkdown>
          </p>
        </section>
      )}
      <section>
        <SectionTitle hint={`${files.length} 个文件，按阅读顺序`}>
          文件清单
        </SectionTitle>
        <ol className="divide-y rounded-xl border">
          {files.map((f, i) => (
            <li
              key={f.path}
              className="group flex items-start gap-3 px-3 py-2.5"
            >
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px]">{f.path}</p>
                {f.reason && (
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {f.reason}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100">
                <IconButton
                  label="上移"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp />
                </IconButton>
                <IconButton
                  label="下移"
                  disabled={i === files.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown />
                </IconButton>
                <IconButton
                  label="移除"
                  onClick={() =>
                    setFiles((prev) => prev.filter((x) => x.path !== f.path))
                  }
                >
                  <X />
                </IconButton>
              </div>
            </li>
          ))}
          <li className="px-3 py-2.5">
            <AddFile
              project={topic.project}
              exclude={files.map((f) => f.path)}
              onAdd={(path) =>
                setFiles((prev) => [...prev, { path, reason: "手动添加" }])
              }
            />
          </li>
        </ol>
      </section>
      <section className="space-y-2">
        <Label htmlFor="confirm-instructions">
          补充要求
          <span className="font-normal text-subtle-foreground">
            追加到下面每个提示词末尾
          </span>
        </Label>
        <Textarea
          id="confirm-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="例如：重点讲错误处理和重试；用面向新人的语气"
        />
      </section>
      <section className="space-y-2">
        <Label htmlFor="confirm-model">
          生成用的模型
          <span className="font-normal text-subtle-foreground">
            这个主题的说明和导读都用它
          </span>
        </Label>
        <ModelSelect
          id="confirm-model"
          value={choice}
          onChange={setModel}
          className="sm:max-w-sm"
        />
      </section>
      <section className="space-y-2">
        <SectionTitle hint="确认后，会按下面的提示词发送请求">
          将使用的提示词
        </SectionTitle>
        {shown?.map((p) => (
          <PromptBlock key={p.id} prompt={p} instructions={instructions} />
        ))}
      </section>
      <div className="flex flex-wrap items-center gap-2 border-t pt-6">
        <Button
          disabled={!files.length || !choice || confirm.isPending}
          onClick={() =>
            confirm.mutate({
              topic: topic.id,
              files,
              instructions,
              ...(choice ? { model: choice } : {}),
            })
          }
        >
          {confirm.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Sparkles />
          )}
          确认并生成 {files.length} 份说明
        </Button>
        <Button
          variant="ghost"
          disabled={replan.isPending}
          onClick={() =>
            replan.mutate({
              topic: topic.id,
              instructions,
              ...(choice ? { model: choice } : {}),
            })
          }
        >
          <RefreshCw />
          重新规划
        </Button>
        <p className="w-full text-xs text-subtle-foreground">
          会调用模型 {files.length + 1} 次：每个文件一次，最后生成一份链路导读。
        </p>
      </div>
    </div>
  );
}

function AddFile({
  project,
  exclude,
  onAdd,
}: {
  project: string;
  exclude: string[];
  onAdd: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const files = useFiles(project);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    const taken = new Set(exclude);
    return (files.data ?? [])
      .filter((f) => !taken.has(f.path) && f.path.toLowerCase().includes(q))
      .slice(0, 8);
  }, [files.data, exclude, q]);
  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Plus className="size-4 shrink-0" />
        <span className="sr-only">添加文件</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索并添加文件"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle-foreground"
        />
        {q && <Search className="size-3.5" />}
      </label>
      {matches.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {matches.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => {
                  onAdd(f.path);
                  setQuery("");
                }}
                className="w-full truncate rounded-md px-2 py-1 text-left font-mono text-xs hover:bg-accent"
              >
                {f.path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Walkthrough({
  topic,
  onOpenFile,
}: {
  topic: Topic;
  onOpenFile: (path: string) => void;
}) {
  const refresh = useRefreshTopic();
  const jobs = useJobs();
  const prompts = usePrompts();
  const active = jobs.data?.filter(
    (j) =>
      j.topic === topic.id && (j.state === "queued" || j.state === "running"),
  );
  const failed = jobs.data?.filter(
    (j) => j.topic === topic.id && j.state === "failed",
  );
  const outdated = topic.entries.filter((e) => e.status !== "fresh").length;
  const busy = Boolean(active?.length);
  const latestFailure = failed?.find(
    (j) =>
      !topic.entries.some((e) => e.path === j.path && e.status === "fresh"),
  );
  const shown = prompts.data?.filter(
    (p) => p.id === "explain" || p.id === "overview",
  );

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground/80 transition-[width] duration-500"
              style={{
                width: `${topic.files ? (topic.fresh / topic.files) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {topic.fresh} / {topic.files} 份说明最新
          </span>
        </div>
        {(busy || outdated > 0) && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            {busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                正在生成，剩余 {active!.length} 个任务
              </>
            ) : (
              <>
                <CircleAlert className="size-3.5 text-warning" />
                {outdated} 份说明缺失或已过期
                {latestFailure?.error && `（最近失败：${latestFailure.error}）`}
                <Button
                  size="xs"
                  variant="outline"
                  className="ml-1"
                  disabled={refresh.isPending}
                  onClick={() => refresh.mutate(topic.id)}
                >
                  <RefreshCw />
                  更新
                </Button>
              </>
            )}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>链路导读</SectionTitle>
        {topic.overview ? (
          <>
            <p className="text-[15px] leading-7 text-pretty">
              <InlineMarkdown>{topic.overview.summary}</InlineMarkdown>
            </p>
            {topic.overview.diagram && (
              <Diagram
                code={topic.overview.diagram}
                title={`${topic.title} · 链路全景`}
                className="mt-5"
              />
            )}
            <ol className="mt-5 space-y-1">
              {topic.overview.steps.map((s, i) => (
                <li key={`${s.path}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onOpenFile(s.path)}
                    className="-mx-2 flex w-[calc(100%+1rem)] gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
                  >
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>
                    <span className="min-w-0 text-sm leading-6">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        {s.label && (
                          <span className="font-medium">{s.label}</span>
                        )}
                        <span className="font-mono text-xs text-subtle-foreground">
                          {s.path}
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        <InlineMarkdown>{s.description}</InlineMarkdown>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {topic.overview.caveats.length > 0 && (
              <ul className="mt-5 list-disc space-y-1 pl-5 text-sm text-muted-foreground marker:text-subtle-foreground">
                {topic.overview.caveats.map((c, i) => (
                  <li key={i}>
                    <InlineMarkdown>{c}</InlineMarkdown>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {busy
              ? "所有文件的说明生成后，会自动写一份导读把它们串起来。"
              : "导读尚未生成。"}
          </p>
        )}
      </section>

      <section>
        <SectionTitle hint="点击打开源码与说明">文件</SectionTitle>
        <ol className="-mx-2">
          {topic.entries.map((e, i) => (
            <FileRow key={e.path} entry={e} index={i} onOpen={onOpenFile} />
          ))}
        </ol>
      </section>

      <section className="space-y-2">
        <SectionTitle>本主题的提示词</SectionTitle>
        {topic.instructions && (
          <p className="rounded-xl bg-muted px-3.5 py-2.5 text-sm">
            <span className="text-muted-foreground">补充要求：</span>
            {topic.instructions}
          </p>
        )}
        {shown?.map((p) => (
          <PromptBlock
            key={p.id}
            prompt={p}
            instructions={topic.instructions}
          />
        ))}
      </section>
    </div>
  );
}

function FileRow({
  entry,
  index,
  onOpen,
}: {
  entry: TopicFile;
  index: number;
  onOpen: (path: string) => void;
}) {
  const { dir, name } = splitPath(entry.path);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(entry.path)}
        title={fileStatusLabel[entry.status]}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
      >
        <span className="w-5 shrink-0 text-right text-xs text-subtle-foreground tabular-nums">
          {index + 1}
        </span>
        <StatusDot status={entry.status} />
        <span className="shrink-0">{name}</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-subtle-foreground">
          {dir}
        </span>
      </button>
    </li>
  );
}

function DeleteTopic({
  topic,
  onDeleted,
}: {
  topic: Topic;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const remove = useRemoveTopic();
  return (
    <div className="mt-12 border-t pt-6">
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 />
        删除主题
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>删除“{topic.title}”？</AlertDialogTitle>
            <AlertDialogDescription>
              这个主题生成的 {topic.files}{" "}
              份说明和导读会一起删除，进行中的任务会被取消。源码不受影响，你可以随时重新创建。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">取消</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-white hover:bg-destructive/90"
              onClick={() => remove.mutate(topic.id, { onSuccess: onDeleted })}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SectionTitle({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <h3 className="mb-3 flex items-baseline gap-2 text-[13px] font-semibold">
      {children}
      {hint && (
        <span className="text-xs font-normal text-subtle-foreground">
          {hint}
        </span>
      )}
    </h3>
  );
}

function IconButton({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & React.ComponentProps<"button">) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      className={cn(props.disabled && "invisible")}
      {...props}
    >
      {children}
    </Button>
  );
}
