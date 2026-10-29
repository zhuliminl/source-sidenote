import { useState, type ReactNode } from "react";
import { Check, ChevronRight, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { AgentSetup } from "@shared/api";
import { Button } from "@/components/ui/button";
import { useAgentGuide, useAgentSetup } from "@/lib/queries";
import { cn } from "@/lib/utils";

const tools: [string, string][] = [
  [
    "get_guide",
    "读取写作指南：工作流程、写作风格和各类内容的 JSON 结构。Agent 写任何内容前都应先读它。",
  ],
  ["list_projects", "列出已注册的项目。"],
  ["list_topics", "列出一个项目的主题和说明进度。"],
  [
    "get_topic",
    "读取主题：描述、补充要求、项目根目录、按阅读顺序排列的文件和状态。",
  ],
  ["locate_file", "按绝对路径查文件属于哪个项目、被哪些主题覆盖。"],
  [
    "create_topic",
    "新建主题，由 Agent 自己挑选文件；直接确认，不调用本服务的模型。",
  ],
  ["get_explanation", "读取某个文件现有的说明，方便在此基础上改写。"],
  ["submit_explanation", "提交一个文件的说明，服务端校验格式和行号后保存。"],
  ["submit_overview", "提交整条链路的导读。"],
  ["submit_story", "提交一个故事：围绕一个问题，一步步定位到代码段。"],
];

const quote = (s: string) =>
  /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;

function snippets(setup: AgentSetup) {
  const env = Object.entries(setup.env);
  const claude = [
    "claude mcp add sidenote --scope user",
    ...env.map(([k, v]) => `-e ${k}=${quote(v)}`),
    "--",
    quote(setup.command),
    ...setup.args.map(quote),
  ].join(" ");
  const toml = [
    "[mcp_servers.sidenote]",
    `command = ${JSON.stringify(setup.command)}`,
    `args = [${setup.args.map((a) => JSON.stringify(a)).join(", ")}]`,
    ...(env.length
      ? [
          "",
          "[mcp_servers.sidenote.env]",
          ...env.map(([k, v]) => `${k} = ${JSON.stringify(v)}`),
        ]
      : []),
  ].join("\n");
  const json = JSON.stringify(
    {
      mcpServers: {
        sidenote: {
          command: setup.command,
          args: setup.args,
          ...(env.length ? { env: setup.env } : {}),
        },
      },
    },
    null,
    2,
  );
  return { claude, toml, json };
}

/**
 * Settings → 接入 Agent: how to connect Claude Code, Codex or any MCP client to this service so it
 * can write topics. The commands carry this machine's actual Node and install paths.
 */
export function AgentSettings() {
  const setup = useAgentSetup();
  if (!setup.data)
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-subtle-foreground" />
      </div>
    );
  const s = snippets(setup.data);
  return (
    <div className="max-w-3xl space-y-8 pb-8 text-sm leading-7">
      <section>
        <p className="text-[15px] text-muted-foreground">
          本服务自己调用模型时，每次只看一个文件。Claude Code、Codex 这类编码
          Agent
          可以先在整个仓库里探索——顺着调用方和被调用方读、看测试——再动笔，往往写得更透彻。通过{" "}
          <a
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            MCP
          </a>{" "}
          接入后，Agent 可以读取你的主题，并提交说明、导读和故事。
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            提交的内容由本服务校验（格式、真实路径、行号在文件范围内），不合格会把原因返回给
            Agent 让它修正。
          </li>
          <li>
            内容署名为{" "}
            <code className="font-mono text-[13px]">
              agent:&lt;客户端名&gt;
            </code>
            ，只在代码变化时过期，不随换模型过期。
          </li>
          <li>
            Agent
            被要求只读代码、不修改文件；它读取的代码可能多于主题的文件清单，用的是
            Agent 自己的额度。
          </li>
          <li>使用时本服务需要在运行（sidenote start）。</li>
        </ul>
      </section>

      <Step n={1} title="Claude Code">
        <p className="text-muted-foreground">
          在终端运行一次，注册到你的用户配置（所有项目可用）：
        </p>
        <Code text={s.claude} />
        <p className="text-muted-foreground">
          新开一个 Claude Code 会话后，输入{" "}
          <code className="font-mono text-[13px]">
            /mcp__sidenote__explain_topic
          </code>{" "}
          （可带主题 id），或直接说“用 sidenote 的工具，为某某主题写说明”。
        </p>
      </Step>

      <Step n={2} title="Codex">
        <p className="text-muted-foreground">
          加到{" "}
          <code className="font-mono text-[13px]">~/.codex/config.toml</code>：
        </p>
        <Code text={s.toml} />
        <p className="text-muted-foreground">
          然后对 Codex 说“用 sidenote 的工具，先读
          get_guide，再为某某主题写说明”。
        </p>
      </Step>

      <Step n={3} title="其他 MCP 客户端">
        <p className="text-muted-foreground">
          Cursor、Claude Desktop、Windsurf 等支持 stdio MCP
          的客户端，按各自的配置位置加入：
        </p>
        <Code text={s.json} />
      </Step>

      <section>
        <h2 className="mb-2 text-[13px] font-semibold">可用工具</h2>
        <div className="divide-y rounded-xl border">
          {tools.map(([name, desc]) => (
            <div
              key={name}
              className="flex gap-4 px-4 py-2.5 max-sm:flex-col max-sm:gap-0"
            >
              <code className="w-44 shrink-0 font-mono text-[13px]">
                {name}
              </code>
              <span className="text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-subtle-foreground">
          另有提示词 explain_topic：让 Agent
          按指南为一个主题写完说明、导读和故事（Claude Code 中显示为斜杠命令）。
        </p>
      </section>

      <Guide />
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-[15px] font-medium">
        <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[11px] tabular-nums">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Code({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <pre className="rounded-xl bg-muted px-4 py-3 pr-12 font-mono text-[12.5px] leading-6 break-all whitespace-pre-wrap">
        {text}
      </pre>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="复制"
        className="absolute top-2 right-2 bg-background/80 text-muted-foreground"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast("已复制");
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

/** The full writing guide agents receive from get_guide, so users know exactly what is asked. */
function Guide() {
  const guide = useAgentGuide();
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[13px] font-semibold"
      >
        <ChevronRight
          className={cn("size-4 transition-transform", open && "rotate-90")}
        />
        Agent 收到的写作指南（get_guide 原文）
      </button>
      {open && guide.data && (
        <pre className="mt-2 max-h-[60vh] overflow-auto rounded-xl border px-4 py-3 text-[12.5px] leading-6 whitespace-pre-wrap scrollbar-thin">
          {guide.data.guide}
        </pre>
      )}
    </section>
  );
}
