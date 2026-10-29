import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { PromptBlock } from "@/components/prompt-block";
import { usePrompts } from "@/lib/queries";

/** Everything the service tells the model, verbatim, so users know what they are paying for. */
export function PromptsPage() {
  const prompts = usePrompts();
  return (
    <>
      <PageHeader>
        <h1 className="px-2.5 text-lg font-medium">提示词</h1>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-3xl px-6 pt-4 pb-16">
          <p className="text-[15px] leading-7 text-muted-foreground">
            每个主题按下面的顺序调用模型。这里显示的就是实际发送的系统提示词；你在主题里填写的补充要求会追加在末尾（复查除外）。
          </p>
          <ol className="mt-6 grid gap-2 text-sm sm:grid-cols-4">
            {["规划：挑文件", "你确认清单", "逐个解释文件", "生成链路导读"].map(
              (step, i) => (
                <li
                  key={step}
                  className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] tabular-nums">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ),
            )}
          </ol>
          <div className="mt-8 space-y-3">
            {prompts.isPending
              ? Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-11 rounded-xl" />
                ))
              : prompts.data?.map((p) => (
                  <PromptBlock key={p.id} prompt={p} open />
                ))}
          </div>
          <p className="mt-8 flex gap-2.5 rounded-xl bg-muted px-4 py-3 text-[13px] leading-6 text-muted-foreground">
            <ShieldCheck className="mt-1 size-4 shrink-0" />
            <span>
              源码、README
              和文件名都作为数据发送，并要求模型忽略其中的指令。规划阶段只发送文件路径和
              README/构建清单，不发送源码；只有你确认清单后，才会把选中文件的源码发送给模型。模型输出会被校验：编造的路径会被丢弃，引用了不存在行号的说明会被拒绝。
            </span>
          </p>
        </div>
      </div>
    </>
  );
}
