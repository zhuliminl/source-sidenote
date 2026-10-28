# 架构与边界

采用模块化单体：一个服务进程，一个 SQLite 数据库，多个客户端。无需 Docker、Redis、独立数据库服务。

```text
src/shared          HTTP 契约类型（服务端、CLI、管理页共用，仅类型）
src/domain          实体、错误类型、说明校验与 Markdown 渲染；不依赖 HTTP/数据库
src/application     用例：ProjectService（注册/扫描/调度/统计）、JobWorker（队列执行）、
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

文档记录源码哈希、上下文哈希、提示词版本、模型标识、JSON 正文、Markdown、生成时间、复查 JSON。当前换模型不会自动使已有文档失效；手动刷新可以替换。生成开始和写入前分别检查源码/上下文，阻止过期结果写回。

上下文包含有限清单、README/构建文件和可解析的直接导入片段。上下文指纹只覆盖直接依赖（路径 + 内容哈希）：新增无关文件或修改 README 不会让整个项目的说明失效。不声称完成完整架构分析；依赖解析目前不支持 tsconfig aliases、Java wildcard、继承/反射或间接调用。

## 生命周期

`add → realpath → 扫描 → 更新清单 → 指纹比对 → 限量入队 → 模型 → JSON/行号/引用校验 → 保存`

任务状态 queued/running/done/failed/cancelled。数据库部分唯一索引阻止同文件同类型重复活动任务。正常停止将中断的活动任务恢复 queued；进程崩溃后启动将 running 恢复 queued。模型请求不能保证 exactly-once：崩溃可能造成重复计费，但文档写入是幂等替换。

生成和复查共用队列；复查只能针对当前有效说明，写回时用生成时间防止覆盖新说明的复查记录。复查保存结论、具体问题、模型和时间，不自动修改代码。

## API

无需登录：服务只监听 127.0.0.1，请求的 Host 必须是 `127.0.0.1:<端口>`，带 Origin 时必须同源，否则返回 403。

| 路径                                 | 用途                                          |
| ------------------------------------ | --------------------------------------------- |
| GET /api/status                      | 服务状态                                      |
| GET/PUT /api/config                  | 脱敏读取/更新模型配置                         |
| GET/POST /api/projects               | 列表/注册并开始任务                           |
| POST /api/projects/:id/refresh       | 重新扫描                                      |
| POST /api/projects/:id/run           | `{kind: generate 或 review, path?: 相对路径}` |
| GET /api/projects/:id/files          | 文件清单与每个文件的说明状态                  |
| DELETE /api/projects/:id             | 移除项目及其说明/任务（不触碰源码）           |
| GET /api/projects/:id/source?path=   | 扫描范围内文件的当前源码（阅读器用）          |
| GET /api/projects/:id/document?path= | 文档与新鲜状态                                |
| GET /api/jobs                        | 最近 200 个任务                               |
| POST /api/jobs/:id/cancel            | 取消                                          |
| GET /api/events                      | SSE 变更通知                                  |
| POST /api/stop                       | 停止                                          |

0.1 为开发协议，尚未承诺 API 向后兼容。未来发布稳定版前增加 /v1 路径、迁移和协议兼容测试。

## 后续顺序

1. 真实模型与真实项目小样本验收；质量和费用记录。
2. 增量索引、明确的预算、模型适配与测试连接。
3. 项目/模块摘要与依赖传播，自动标记过期。
4. 浏览器代码双栏阅读、VS Code 扩展。
