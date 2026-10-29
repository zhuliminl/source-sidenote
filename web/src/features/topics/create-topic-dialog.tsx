import { useState, type FormEvent } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PromptBlock } from "@/components/prompt-block";
import { useCreateTopic, usePrompts } from "@/lib/queries";

const examples = [
  "一个请求从路由进来到写入数据库的完整链路",
  "登录鉴权是怎么做的",
  "后台任务如何排队、执行和失败重试",
];

/** Step one of a topic: describe it. Only file paths and the README go to the model here. */
export function CreateTopicDialog({
  project,
  open,
  onOpenChange,
  onCreated,
}: {
  project: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (topic: string) => void;
}) {
  const [request, setRequest] = useState("");
  const [instructions, setInstructions] = useState("");
  const create = useCreateTopic(project);
  const prompts = usePrompts();
  const plan = prompts.data?.find((p) => p.id === "plan");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!request.trim() || create.isPending) return;
    create.mutate(
      { request, instructions },
      {
        onSuccess: (t) => {
          setRequest("");
          setInstructions("");
          onOpenChange(false);
          onCreated(t.id);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>新建主题</DialogTitle>
            <DialogDescription>
              说说你想弄懂什么。AI
              会先根据文件清单挑出相关文件，你确认后才会读源码、生成说明。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="topic-request">想了解什么</Label>
            <Textarea
              id="topic-request"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="例如：一个说明从排队到写回数据库的完整链路"
              className="min-h-20"
              autoFocus
            />
            <div className="flex flex-wrap gap-1.5">
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setRequest(ex)}
                  className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="topic-instructions">
              补充要求
              <span className="font-normal text-subtle-foreground">
                可选，追加到这个主题的每个提示词末尾
              </span>
            </Label>
            <Textarea
              id="topic-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="例如：重点讲错误处理；我熟悉 React，不用解释基础概念"
            />
          </div>
          {plan && <PromptBlock prompt={plan} instructions={instructions} />}
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
              disabled={!request.trim() || create.isPending}
            >
              {create.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              开始规划
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
