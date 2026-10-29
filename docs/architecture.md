# 架构与边界

采用模块化单体：一个服务进程，一个 SQLite 数据库，多个客户端。无需 Docker、Redis、独立数据库服务。

```text
src/shared          HTTP 契约类型（服务端、CLI、管理页共用，仅类型）
src/domain          实体、错误类型、说明校验与 Markdown 渲染；不依赖 HTTP/数据库
src/application     用例：ProjectService（注册/扫描/覆盖率）、TopicService（主题规划/确认/更新/删除）、
                    JobWorker（队列执行：plan/generate/review/overview）、
                    ConfigService（zod 校验）、freshness（唯一的新鲜度定义）、container（组装）
src/infrastructure  persistence（SQLite 迁移、仓储、配置文件）、source（扫描/安全读取/上下文）、
                    llm（Chat Completions 客户端与提示词）、路径与服务锁
src/transport/http  服务生命周期、安全钩子（Host/Origin/CSP）、错误映射、路由、管理页静态资源
src/cli             parseArgs 解析 + 命令表，通过 HTTP 使用服务
web                 管理页：Vite + React 19 + TanStack Query + Tailwind v4 + shadcn/ui，构建到 dist/web
editors/neovim      仅负责编辑器显示与 CLI 调用
```

仓储按表拆分并返回类型化记录，SQL 只出现在 infrastructure/persistence。application 直接依赖这些具体实现，组装集中在 container.ts；尚未为只有一个实现的组件抽象接口。任务执行由事件驱动（入队、配置变更、任务结束时唤醒），不再轮询。第二种模型协议或存储出现时再提取窄接口。未来 VS Code 使用相同 HTTP 协议。

## 身份与缓存

项目由 canonical realpath 唯一识别，数据库分配 UUID；同一 remote 的不同工作副本不混用数据。文件键为项目 UUID + 相对路径。重命名按旧文件移除、新文件加入处理。

说明以（主题，文件）为键，记录源码哈希、上下文哈希、提示词版本、模型标识、JSON 正文、Markdown、生成时间、复查 JSON。主题记录用户描述、补充要求、状态（planning / plan_failed / planned / confirmed）、规划说明、模型与链路导读；topic_files 保存确认后的文件、阅读顺序与入选理由。新鲜度 = 源码哈希 + 直接依赖指纹 + 提示词版本 + 当前配置的模型；换模型后已有文档变为待更新（未配置模型时不比较模型）。生成开始和写入前分别检查源码/上下文，阻止过期结果写回。

规划上下文是文件清单（仅路径）和 README/构建文件；解释上下文是主题、主题文件的阅读顺序与入选理由、当前源码和可解析的直接导入片段。上下文指纹只覆盖直接依赖（路径 + 内容哈希）：新增无关文件或修改 README 不会让整个项目的说明失效。不声称完成完整架构分析；依赖解析目前不支持 tsconfig aliases、Java wildcard、继承/反射或间接调用。

## 模型配置

config.json 保存供应商列表（名称、开关、API 格式、Base URL、密钥、模型及其开关）、默认模型 `{provider, model}` 和生成偏好。每个主题记录自己的模型（topics.provider/model）：新建时默认取默认模型，确认文件或重新规划时可以换；之后改默认模型不影响已有主题。v4 之前的主题 provider 为空，跟随默认模型。主题所选模型被关闭或删除时，它的任务失败并提示换模型；没有任何可用模型时队列暂停。旧版单模型配置在读取时升级为一个供应商。OpenAI 格式的 Base URL 含版本（`…/v1` + `/chat/completions`），Anthropic 格式不含（+ `/v1/messages`）。新鲜度比较主题所选模型的 ID。

## 阅读器联动

说明的 evidence 和 diagramLinks（flowchart 节点 → 行号）把说明和代码连起来，以“块”为单位：代码行悬停时，覆盖它的最窄那条依据整段高亮，右侧把这条依据滚到与代码块顶部对齐（代码滚动时保持对齐）；点击代码选中整块；在右侧点击依据，代码滚到让这块顶部与依据对齐。左右所有高亮用同一种样式。导读的 diagramLinks（节点 → 主题文件）让全景图节点可以打开文件。TopicFile.links 来自说明里指向同一主题文件的 relations，用于结构图。

## 生命周期

`add → realpath → 扫描 → 更新清单`（不调用模型）

`新建主题 → plan 任务（路径校验、去重、限量）→ 用户增删排序并确认 → 每个文件一个 generate 任务 → JSON/行号/引用校验 → 保存 → 全部完成后 overview 任务 → 链路导读`

删除主题会删除其文件清单、说明，并取消未完成的任务；进行中的模型请求返回后发现主题已删除即丢弃结果。

任务状态 queued/running/done/failed/cancelled。数据库部分唯一索引阻止同主题、同文件、同类型的重复活动任务。正常停止将中断的活动任务恢复 queued；进程崩溃后启动将 running 恢复 queued。模型请求不能保证 exactly-once：崩溃可能造成重复计费，但文档写入是幂等替换。

生成和复查共用队列；复查只能针对当前有效说明，写回时用生成时间防止覆盖新说明的复查记录。复查保存结论、具体问题、模型和时间，不自动修改代码。

## API

无需登录：服务只监听 127.0.0.1，请求的 Host 必须是 `127.0.0.1:<端口>`，带 Origin 时必须同源，否则返回 403。

| 路径                               | 用途                                                           |
| ---------------------------------- | -------------------------------------------------------------- |
| GET /api/status                    | 服务状态                                                       |
| GET/PUT /api/config                | 脱敏读取（供应商、默认模型）/更新默认模型与生成偏好            |
| POST /api/providers                | 添加供应商 `{name, format, baseUrl, apiKey?, models?}`         |
| PUT/DELETE /api/providers/:id      | 修改（字段可选，apiKey 省略则保留）/删除供应商                 |
| POST /api/providers/:id/test       | `{model}` 发送一个极短请求测试连接                             |
| POST /api/providers/:id/discover   | 读取供应商 `/models` 列表（不保存）                            |
| POST /api/pick-folder              | 在本机弹出系统文件夹选择框，返回所选绝对路径                   |
| GET /api/prompts                   | 全部系统提示词原文及随附内容说明                               |
| GET/POST /api/projects             | 列表（含覆盖率、主题数）/注册并扫描                            |
| POST /api/projects/:id/refresh     | 重新扫描                                                       |
| GET /api/projects/:id/files        | 文件清单与覆盖每个文件的主题                                   |
| GET /api/projects/:id/source?path= | 扫描范围内文件的当前源码（阅读器用）                           |
| DELETE /api/projects/:id           | 移除项目及其主题/说明/任务（不触碰源码）                       |
| GET/POST /api/projects/:id/topics  | 主题列表/新建主题并开始规划 `{request, instructions?, model?}` |
| GET/DELETE /api/topics/:id         | 主题详情（文件、状态、导读）/删除主题及其说明                  |
| POST /api/topics/:id/plan          | 重新规划（未确认的主题）                                       |
| POST /api/topics/:id/confirm       | `{files: [{path, reason}], instructions?, model?}` 确认并生成  |
| POST /api/topics/:id/refresh       | 生成缺失或过期的说明                                           |
| POST /api/topics/:id/run           | `{path, kind: generate 或 review}` 单文件重新生成/复查         |
| GET /api/topics/:id/document?path= | 文件在该主题下的说明与新鲜状态                                 |
| GET /api/jobs                      | 最近 200 个任务（含主题名）                                    |
| POST /api/jobs/:id/cancel          | 取消                                                           |
| GET /api/events                    | SSE 变更通知                                                   |
| POST /api/stop                     | 停止                                                           |

0.1 为开发协议，尚未承诺 API 向后兼容。未来发布稳定版前增加 /v1 路径、迁移和协议兼容测试。

## 后续顺序

1. 真实模型与真实项目小样本验收；质量和费用记录。
2. 增量索引、明确的预算、模型适配与测试连接。
3. 规划阶段使用更丰富的结构信号（导入图、符号索引），提高大仓库的选文件质量。
4. VS Code 扩展适配主题（目前在独立分支，基于旧的逐文件接口）。
