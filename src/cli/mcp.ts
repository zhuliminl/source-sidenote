import { createInterface } from "node:readline";
import type {
  DocumentView,
  LocateResult,
  ProjectSummary,
  StoryView,
  TopicSummary,
  TopicView,
} from "../shared/api.js";
import { VERSION } from "../version.js";
import type { ApiClient } from "./client.js";

/**
 * `sidenote mcp`: a Model Context Protocol server on stdin/stdout, so coding agents (Claude Code,
 * Codex…) can read topics and write their explanations, walkthroughs and stories. It only talks to
 * the local service over HTTP; everything an agent submits is validated there. stdout carries
 * JSON-RPC only.
 */

type Json = Record<string, unknown>;
interface Tool {
  name: string;
  description: string;
  inputSchema: Json;
  run: (args: Json) => Promise<unknown>;
}

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Json, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export async function serveMcp(api: ApiClient) {
  let client = "agent";
  const id = (v: unknown) => encodeURIComponent(String(v ?? ""));

  const tools: Tool[] = [
    {
      name: "get_guide",
      description:
        "读取 Source Sidenote 的写作指南：工作流程、写作风格，以及说明、导读、故事的 JSON 结构。写任何内容之前先调用它并照做。",
      inputSchema: obj({}),
      run: async () => (await api.get<{ guide: string }>("agent/guide")).guide,
    },
    {
      name: "list_projects",
      description: "列出已注册的项目（id、名称、根目录、主题数）。",
      inputSchema: obj({}),
      run: async () =>
        (await api.get<ProjectSummary[]>("projects")).map((p) => ({
          id: p.id,
          name: p.name,
          root: p.root,
          topics: p.topics,
        })),
    },
    {
      name: "locate_file",
      description:
        "按绝对路径查文件属于哪个项目、是否在扫描范围内、被哪些主题覆盖。",
      inputSchema: obj({ path: str("文件的绝对路径") }, ["path"]),
      run: (a) => api.get<LocateResult>(`locate?path=${id(a.path)}`),
    },
    {
      name: "list_topics",
      description: "列出一个项目的主题（id、标题、状态、文件数、最新说明数）。",
      inputSchema: obj({ project: str("项目 id") }, ["project"]),
      run: async (a) =>
        (await api.get<TopicSummary[]>(`projects/${id(a.project)}/topics`)).map(
          (t) => ({
            id: t.id,
            title: t.title,
            state: t.state,
            files: t.files,
            fresh: t.fresh,
          }),
        ),
    },
    {
      name: "get_topic",
      description:
        "读取一个主题：描述、补充要求、项目根目录，以及按阅读顺序排列的文件（入选理由、说明状态：missing 缺失、stale 过期、fresh 最新）。",
      inputSchema: obj({ topic: str("主题 id") }, ["topic"]),
      run: async (a) => {
        const t = await api.get<TopicView>(`topics/${id(a.topic)}`);
        const root = (await api.get<ProjectSummary[]>("projects")).find(
          (p) => p.id === t.project,
        )?.root;
        return {
          id: t.id,
          title: t.title,
          state: t.state,
          request: t.request,
          instructions: t.instructions,
          projectRoot: root,
          files: t.entries.map((e, i) => ({
            order: i + 1,
            path: e.path,
            reason: e.reason,
            status: e.status,
          })),
          hasOverview: Boolean(t.overview),
          suggestedStories: t.overview?.questions ?? [],
        };
      },
    },
    {
      name: "create_topic",
      description:
        "新建一个主题，文件由你挑选（路径相对于项目根目录，按建议阅读顺序排列，并写明每个文件的入选理由）。主题会直接确认，不会调用 Source Sidenote 自己的模型。",
      inputSchema: obj(
        {
          project: str("项目 id"),
          request: str("读者想弄懂什么，一两句话"),
          title: str("不超过 20 字的主题名"),
          instructions: str("可选：写作上的补充要求"),
          files: {
            type: "array",
            items: obj({ path: str("相对路径"), reason: str("为什么要读它") }, [
              "path",
              "reason",
            ]),
          },
        },
        ["project", "request", "files"],
      ),
      run: (a) =>
        api
          .post<TopicView>(`agent/projects/${id(a.project)}/topics`, {
            request: a.request,
            title: a.title,
            instructions: a.instructions,
            files: a.files,
            author: client,
          })
          .then((t) => ({ id: t.id, title: t.title, files: t.entries.length })),
    },
    {
      name: "get_explanation",
      description:
        "读取主题里某个文件当前的说明（如果有），方便你在此基础上改写。",
      inputSchema: obj({ topic: str("主题 id"), path: str("相对路径") }, [
        "topic",
        "path",
      ]),
      run: async (a) => {
        const d = await api.get<DocumentView>(
          `topics/${id(a.topic)}/document?path=${id(a.path)}`,
        );
        return d.status === "missing"
          ? { status: "missing" }
          : { status: d.status, author: d.model, explanation: d.explanation };
      },
    },
    {
      name: "submit_explanation",
      description:
        "提交一个文件的说明（结构见 get_guide）。服务端会校验格式和行号，合格后保存并立即出现在网页和编辑器里；不合格会返回原因，修正后重新提交。",
      inputSchema: obj(
        {
          topic: str("主题 id"),
          path: str("相对路径，必须是主题里的文件"),
          explanation: {
            type: "object",
            description: "说明 JSON，结构见 get_guide",
          },
        },
        ["topic", "path", "explanation"],
      ),
      run: (a) =>
        api.post(`agent/topics/${id(a.topic)}/explanations`, {
          path: a.path,
          explanation: a.explanation,
          author: client,
        }),
    },
    {
      name: "submit_overview",
      description:
        "提交整条链路的导读（结构见 get_guide），一般在所有文件的说明都写完后提交。",
      inputSchema: obj(
        {
          topic: str("主题 id"),
          overview: {
            type: "object",
            description: "导读 JSON，结构见 get_guide",
          },
        },
        ["topic", "overview"],
      ),
      run: (a) =>
        api.post(`agent/topics/${id(a.topic)}/overview`, {
          overview: a.overview,
          author: client,
        }),
    },
    {
      name: "submit_story",
      description:
        "提交一个故事：围绕一个问题，按执行顺序一步步定位到主题文件里的代码段（结构见 get_guide）。",
      inputSchema: obj(
        {
          topic: str("主题 id"),
          question: str("这个故事回答的问题"),
          title: str("不超过 20 字的故事名"),
          steps: {
            type: "array",
            items: obj(
              {
                path: str("主题中的文件"),
                start: { type: "integer" },
                end: { type: "integer" },
                title: str("不超过 12 字的这一步"),
                narration: str("两三句完整的话"),
              },
              ["path", "start", "end", "title", "narration"],
            ),
          },
        },
        ["topic", "question", "steps"],
      ),
      run: (a) =>
        api
          .post<StoryView>(`agent/topics/${id(a.topic)}/stories`, {
            question: a.question,
            title: a.title,
            steps: a.steps,
            author: client,
          })
          .then((s) => ({ id: s.id, title: s.title, steps: s.steps.length })),
    },
  ];

  const prompt = (topic?: string) =>
    [
      "请用 sidenote 的 MCP 工具为一个主题写说明。",
      "1. 先调用 get_guide，严格按指南的工作流程和写作风格来写。",
      topic
        ? `2. 主题 id 是 ${topic}：调用 get_topic 读取它。`
        : "2. 调用 list_projects 和 list_topics 找到要写的主题；如果没有合适的，按指南挑文件并用 create_topic 新建。",
      "3. 按阅读顺序逐个读代码（顺着调用方和被调用方看清它的作用），用 submit_explanation 提交每个文件的说明；状态是 fresh 的可以跳过，除非你能写得明显更好。",
      "4. 全部写完后用 submit_overview 提交导读，再挑一两个导读里推荐的问题用 submit_story 录制故事。",
      "只读代码，不要修改任何文件。最后用几句话告诉我写了哪些内容。",
    ].join("\n");

  const handle = async (method: string, params: Json): Promise<unknown> => {
    switch (method) {
      case "initialize": {
        const info = params.clientInfo as { name?: string } | undefined;
        if (info?.name) client = info.name;
        return {
          protocolVersion: (params.protocolVersion as string) ?? "2025-06-18",
          capabilities: { tools: {}, prompts: {} },
          serverInfo: { name: "source-sidenote", version: VERSION },
          instructions:
            "Source Sidenote：本机的代码阅读服务。先调用 get_guide，再按指南为主题写说明、导读和故事。只读代码，不要修改文件。",
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: tools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        };
      case "tools/call": {
        const tool = tools.find((t) => t.name === params.name);
        if (!tool)
          throw Object.assign(new Error(`Unknown tool: ${params.name}`), {
            code: -32602,
          });
        try {
          const result = await tool.run((params.arguments as Json) ?? {});
          return {
            content: [
              {
                type: "text",
                text:
                  typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (e) {
          // Tool failures go back to the agent as content, so it can fix and retry.
          return {
            content: [{ type: "text", text: (e as Error).message }],
            isError: true,
          };
        }
      }
      case "prompts/list":
        return {
          prompts: [
            {
              name: "explain_topic",
              description:
                "让 Agent 按 Source Sidenote 的写作指南，为一个主题写完说明、导读和故事",
              arguments: [
                {
                  name: "topic",
                  description: "主题 id（可选）",
                  required: false,
                },
              ],
            },
          ],
        };
      case "prompts/get": {
        const args = (params.arguments as Json) ?? {};
        return {
          description: "为一个主题写说明、导读和故事",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: prompt(args.topic as string | undefined),
              },
            },
          ],
        };
      }
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), {
          code: -32601,
        });
    }
  };

  const write = (message: Json) =>
    process.stdout.write(JSON.stringify(message) + "\n");
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let msg: { id?: unknown; method?: string; params?: Json };
    try {
      msg = JSON.parse(line);
    } catch {
      write({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      continue;
    }
    // Notifications (no id), e.g. notifications/initialized, need no answer.
    if (msg.id === undefined || !msg.method) continue;
    try {
      write({
        jsonrpc: "2.0",
        id: msg.id,
        result: await handle(msg.method, msg.params ?? {}),
      });
    } catch (e) {
      const err = e as Error & { code?: number };
      write({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: err.code ?? -32603, message: err.message },
      });
    }
  }
}
