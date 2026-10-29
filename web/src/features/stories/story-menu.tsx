import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  ChevronDown,
  Clapperboard,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { ActiveModel, StoryView, TopicView } from "@shared/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelect } from "@/components/model-select";
import { PromptBlock } from "@/components/prompt-block";
import {
  useConfig,
  useCreateStory,
  usePrompts,
  useRemoveStory,
  useStoryIdeas,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

const stateLabel: Record<StoryView["state"], string> = {
  generating: "录制中",
  ready: "",
  failed: "失败",
};

/** Header menu next to the topic: pick a story to replay, or record a new one. */
export function StoryMenu({
  topic,
  stories,
  current,
  onSelect,
  onClose,
}: {
  topic: TopicView;
  stories: StoryView[];
  current: StoryView | null;
  onSelect: (story: StoryView) => void;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const remove = useRemoveStory();
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex min-w-0 shrink items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[15px] transition-colors hover:bg-accent data-[state=open]:bg-accent",
              !current && "text-muted-foreground",
            )}
          >
            <Clapperboard className="size-4 shrink-0 text-muted-foreground" />
            <span className="max-w-[22ch] truncate">
              {current?.title ?? (stories.length ? "选择故事" : "故事")}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          {stories.map((s) => (
            <DropdownMenuItem
              key={s.id}
              onSelect={() => onSelect(s)}
              className="group"
            >
              {s.state === "generating" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Clapperboard />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{s.title}</span>
                <span className="block text-xs text-subtle-foreground">
                  {s.state === "ready"
                    ? `${s.steps.length} 步`
                    : stateLabel[s.state]}
                </span>
              </span>
              {s.id === current?.id && <Check />}
              <button
                type="button"
                aria-label="删除故事"
                title="删除故事"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (s.id === current?.id) onClose();
                  remove.mutate(s.id);
                }}
                className="rounded p-0.5 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive group-data-[highlighted]:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </DropdownMenuItem>
          ))}
          {stories.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus />
            新建故事…
          </DropdownMenuItem>
          {current && (
            <DropdownMenuItem onSelect={onClose}>
              <X />
              关闭当前故事
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateStoryDialog
        topic={topic}
        stories={stories}
        open={creating}
        onOpenChange={setCreating}
        onCreated={onSelect}
      />
    </>
  );
}

/**
 * Step one of a story: pick suggested questions (from the walkthrough) or write one; each
 * becomes its own story. Only explanations go to the model, not source code.
 */
function CreateStoryDialog({
  topic,
  stories,
  open,
  onOpenChange,
  onCreated,
}: {
  topic: TopicView;
  stories: StoryView[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (story: StoryView) => void;
}) {
  const config = useConfig();
  const create = useCreateStory(topic.id);
  const ideas = useStoryIdeas();
  const prompts = usePrompts();
  const prompt = prompts.data?.find((p) => p.id === "story");
  const asked = new Set(stories.map((s) => s.question));
  const suggested = (topic.overview?.questions ?? []).filter(
    (q) => !asked.has(q),
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [own, setOwn] = useState("");
  const [model, setModel] = useState<ActiveModel | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(new Set());
    setOwn("");
    setModel(
      topic.provider && topic.model
        ? { provider: topic.provider, model: topic.model }
        : (config.data?.active ?? null),
    );
  }, [open, topic.provider, topic.model, config.data?.active]);

  const questions = [
    ...picked,
    ...own
      .split("\n")
      .map((q) => q.trim())
      .filter(Boolean),
  ];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!questions.length || !model) return;
    let first: StoryView | undefined;
    for (const question of questions) {
      const s = await create.mutateAsync({ question, model });
      first ??= s;
    }
    onOpenChange(false);
    if (first) onCreated(first);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>新建故事</DialogTitle>
            <DialogDescription>
              围绕一个具体问题，让 AI
              在这个主题的文件里“录制”一段跟着代码走的导览：每一步打开哪个文件、看哪几行、发生了什么。录好后可以在底部进度条上来回回放。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>
              推荐的故事
              <span className="font-normal text-subtle-foreground">
                来自链路导读，可多选，每个生成一条故事
              </span>
            </Label>
            {suggested.length ? (
              <ul className="space-y-1">
                {suggested.map((q) => (
                  <li key={q}>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-accent">
                      <input
                        type="checkbox"
                        checked={picked.has(q)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(q);
                          else next.delete(q);
                          setPicked(next);
                        }}
                        className="mt-1 size-4 accent-foreground"
                      />
                      {q}
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
                <span className="flex-1">
                  {topic.overview
                    ? "这个主题的导读还没有推荐故事。"
                    : "导读生成后会自动推荐几个故事。"}
                </span>
                {topic.overview && (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={ideas.isPending}
                    onClick={() => ideas.mutate(topic.id)}
                  >
                    {ideas.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Sparkles />
                    )}
                    让 AI 推荐
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="story-question">
              自己写
              <span className="font-normal text-subtle-foreground">
                一行一个问题
              </span>
            </Label>
            <Textarea
              id="story-question"
              value={own}
              onChange={(e) => setOwn(e.target.value)}
              placeholder="例如：一次翻译查询请求从 Controller 到数据库，依次经过哪些代码？"
              className="min-h-20"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="story-model">模型</Label>
            <ModelSelect id="story-model" value={model} onChange={setModel} />
          </div>

          {prompt && (
            <PromptBlock prompt={prompt} instructions={topic.instructions} />
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={!questions.length || !model || create.isPending}
            >
              {create.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Clapperboard />
              )}
              录制{" "}
              {questions.length > 1 ? `${questions.length} 条故事` : "故事"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
