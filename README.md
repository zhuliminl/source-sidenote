# Source Sidenote · 源旁注

**代码旁边，多一份理解。** A local-first AI code reading service with shared, persistent explanations.

Source Sidenote 按**主题**帮你读懂本地项目：描述你想弄懂的功能或链路，AI 先挑出相关文件，你确认后才逐个生成有代码依据的说明，最后写一份把这些文件串起来的链路导读。不必为了读懂一条链路而解释整个仓库。独立 Node 服务管理模型、项目和生成任务；编辑器里负责 review：VS Code 扩展把代码依据标在代码上、按光标对应说明，Neovim 通过轻量适配器在当前代码窗口右侧显示 Markdown。

> **0.1.0 开发预览**：可以从 GitHub 源码运行，尚未发布到 npm 和 VS Code 插件市场。自动化测试使用模拟模型；真实模型的质量、费用和不同提供商兼容性仍需在你的项目上验收。不要将 AI 复查通过当成正确性证明。

**English** — Source Sidenote helps you understand a local codebase one _topic_ at a time. Describe the flow you want to learn; an AI picks the relevant files, you confirm the list, then it writes a diagram-first, evidence-linked explanation for each file plus a walkthrough that ties them together. A web reader shows code and explanations side by side (hover a block of code to see the matching evidence), a floating topic map, and replayable "stories" that step through the code for one question. VS Code and Neovim plugins bring the explanations next to your code for review. Everything runs on your machine against any OpenAI-compatible or Anthropic-compatible model endpoint you configure. The UI is in Chinese for now.

## 当前可用

- 一个本机服务管理多个项目，内置中文管理页（React + Vite + shadcn/ui，浅色/深色，支持手机宽度）。
- 多个模型供应商（参考 ZCode 的配置方式）：每个供应商有名称、API 格式（OpenAI Chat Completions 或 Anthropic Messages）、Base URL、密钥和模型列表；供应商和模型都可以单独开关，模型列表可从供应商的 `/models` 接口获取，每个模型可以一键测试连接。每个主题在新建时选模型（默认选中设置里的默认模型），确认文件时还可以换；改默认模型不影响已有主题。并发、每个主题的文件上限、超时在设置里配置。
- 主题流程：描述主题（可加补充要求）→ AI 规划文件与阅读顺序 → 你增删、排序并确认 → 逐文件生成说明 → 链路导读。确认前不会把源码发给模型。主题可删除并重新创建。
- 以图为主：每份说明先给一张 Mermaid 流程图或时序图，文字只做简短补充；链路导读附带整条链路的全景图。图可放大查看，渲染失败时可查看源码。
- 主题地图：悬浮在窗口左下角，可拖动、四边四角都可调大小、可收起（位置和大小会记住）。两种样式：“线路”按阅读顺序列出每一站（短名 + 文件，标出当前位置和已看过的站），“结构”把主题文件铺成关系图，站点可拖动并按主题记住位置。放大后同样有这两种样式。快捷键：`M` 显示/隐藏地图，`Shift+M` 打开/关闭放大视图（放大时按 `M` 或 `Esc` 回到代码），在输入框里不生效。
- 故事：在已生成说明的主题里，针对一个具体问题让 AI“录制”一段跟着代码走的导览（每一步打开哪个文件、看哪几行、发生了什么）。链路导读会推荐 3–5 个问题，可多选，也可自己写，并选择模型。录好后在顶部切换故事，底部的进度条每段对应一步（长度按代码行数、颜色按文件），可点击、←/→ 或自动播放来回回看，阅读器跟着切文件并高亮对应代码。只发送说明与代码依据，不发送源码。
- 所有系统提示词在管理页“提示词”中原样展示；补充要求会追加在提示词末尾，确认前可以预览。
- 添加项目时可点文件夹图标，由服务弹出系统的文件夹选择框（macOS / Windows；Linux 需 zenity 或 kdialog），也可粘贴绝对路径。`add` 只扫描并注册项目，不调用模型。
- 源码与上下文指纹、Markdown 说明、结构化依据、复查结果持久化。
- 文件树/README/构建配置 + 有限的 JS/TS 相对导入、Java 显式导入上下文。
- 持久化队列、单实例锁、重启恢复、取消；失败后手动重跑，不无限重试。
- 覆盖率 = 至少被一个主题解释的文件 / 扫描纳入的文件；每个主题单独显示最新说明数量。
- Neovim 0.10+：sign 列标出代码依据、光标所在段落高亮并浮窗显示依据，右侧分屏显示说明；全局不绑定快捷键，高亮组可覆盖。

## 从源码运行

需要 **Node 26.12.1+（26.x）**。本项目使用内置 `node:sqlite`，该接口目前仍是 Release Candidate，因此锁定主版本。项目 Node 可用 nvm 等工具独立管理，不要修改旧业务项目的运行环境。

```sh
git clone https://github.com/zhuliminl/source-sidenote.git
cd source-sidenote
npm ci
npm test   # 构建服务端与管理页并跑集成测试
npm start
```

服务默认监听 `127.0.0.1:47831`，自动打开管理页。先配置模型，再添加项目、新建主题。也可以在另一个终端注册项目：

```sh
# 使用克隆下来的 CLI（路径按实际位置修改）
cd /path/to/your-project
node /path/to/source-sidenote/dist/cli/main.js add
```

`start` 默认前台运行，关闭终端会结束服务；任务会保留。在仓库目录执行 `npm link` 后，可以在任何地方直接用 `sidenote` 命令。

```text
sidenote start [--no-open] [--port 47831]
sidenote ui
sidenote status
sidenote projects
sidenote add [directory]
sidenote explain /absolute/file [--topic id]
sidenote stop
```

## VS Code

`editors/vscode` 是按主题 review 代码的扩展：代码依据标在行号旁，光标所在段落高亮并在说明面板里对应，悬停显示依据，资源管理器里有按阅读顺序排列的主题视图，可发起 AI 复查和重新生成，并能跳到网页阅读器的同一位置。安装与开发见 [editors/vscode/README.md](editors/vscode/README.md)。

## Neovim

把本仓库的 `editors/neovim` 加入 runtimepath（或将它作为本地插件加载），需要 Neovim 0.10+ 和 `curl`：

```lua
vim.opt.runtimepath:append('/path/to/source-sidenote/editors/neovim')
require('sidenote').setup({
  -- home = '~/.local/share/source-sidenote', -- 默认取 $SIDENOTE_HOME，与服务一致
  width = 56,
  annotate = true, -- 在 sign 列标出代码依据
  hover = true, -- 光标停在某段代码上时浮窗显示这段的依据
})
```

插件和 VS Code 扩展一样直接调用本机服务（读取 `connection.json`，`curl` 访问 `127.0.0.1`），只负责 review：

- 打开属于某个主题的文件，sign 列会出现细竖线标出每段代码依据；光标所在的那一段整段暖黄色高亮，停一会儿浮窗显示这段的依据。
- `:Sidenote` 在右侧打开说明（焦点留在代码）：一句话说明、核心流程、职责、代码依据（光标所在段对应的条目高亮）、关联文件、阅读注意、AI 复查结果。说明窗口里 `<CR>` 在依据上跳到代码、在关联文件上打开文件，`gr` 重新生成，`gR` AI 复查，`gt` 切换主题，`go` 阅读顺序，`gw` 网页阅读，`q` 关闭。这些映射只在说明窗口内生效。
- `:SidenoteTopic` 选择这个项目要对照阅读的主题（按项目记住；没选时用最新覆盖该文件的主题）。
- `:SidenoteReview`、`:SidenoteRegenerate` 对当前文件发起 AI 复查或重新生成；`:SidenoteOrder` 把主题文件按阅读顺序放进 quickfix（`:cnext` 逐个看）；`:SidenoteWeb` 在网页阅读器打开同一主题、文件和代码段（没有主题时打开项目页去新建）；`:SidenoteClose` 关闭说明。
- 任务完成后通过 `/api/events` 自动刷新。高亮组 `SidenoteBlock`、`SidenoteEvidence` 可自行覆盖。说明针对已保存的文件，有未保存修改时会提示。

新建主题、确认文件、故事和模型设置都在网页阅读器里完成。

## 范围、费用与隐私

- 规划只发送文件路径清单（最多 2000 项）和 README/构建清单；你确认文件清单后，才发送这些文件的源码及其直接依赖片段。
- 默认每个主题最多 15 个文件、并发 2 个请求、每次响应最多 3000 tokens；一个主题约调用模型“文件数 + 2”次（规划 + 每个文件 + 导读）。这是**请求范围限制，不是金额预算保证**。
- 排除依赖、构建产物、隐藏文件、`.env`、密钥扩展名、锁文件、压缩/生成文件、符号链接、空文件、非 UTF-8 编码（如 GBK）、超过 128 KiB 和非源码扩展名的文件。
- 支持根目录和子目录 `.gitignore` / `.sidenoteignore`；不承诺等同 Git 全部忽略语义。被父目录排除的子项不能重新纳入。
- 不在业务项目写入说明，不修改业务源码，不执行仓库脚本。
- 服务只监听回环地址（127.0.0.1），无需登录；通过严格校验 Host/Origin 阻止网页跨站访问和 DNS 重绑定。本机其他进程可以访问服务，与其他本地开发工具一样。
- 密钥保存在权限为 `0600` 的配置文件，**不是加密保险箱**；远程的明文 `http://` 地址允许使用，但密钥和源码会不加密地传输，管理页会提示；不会由配置查询接口回传，也不记录到模型错误日志。操作系统密钥链支持待实现。
- 数据默认在 `~/.local/share/source-sidenote`，可用 `SIDENOTE_HOME` 覆盖。目录权限 `0700`。

## 指标与限制

覆盖率 = 至少被一个已确认主题解释的文件 / 当前扫描纳入文件。说明归属于主题：同一个文件在不同主题里围绕不同链路解释，删除主题会一并删除它的说明。AI 复查结果单独展示，不是正确率。

源文件、已知直接依赖、提示词版本或所配置模型变化会使说明过期，可在主题里一键更新；文件清单和 README/构建文件只用于规划，修改它们不会让说明过期；新增/删除文件和忽略规则变化需要重新扫描或 `add`。尚无文件系统实时监听、完整 AST/LSP 依赖图、架构摘要生成、间接依赖传播、价格统计、自动重试退避或完整资源预算。规划只看文件路径和 README，大仓库中可能漏选文件，可在确认前手动添加。

管理页是完整的阅读器：顶部切换主题；左侧是主题的阅读顺序，或按真实目录展示的文件树（标出主题文件或覆盖情况）；中间是语法高亮源码（Shiki，按需加载语言），右侧是该文件在当前主题下的说明；点击“代码依据”会在源码中定位并高亮对应行，关联文件可直接跳转，链接 `?topic=…&file=…&lines=12-30` 可分享。窄屏下源码/说明切换为标签页。未保存快照为后续计划。

## 开发与发布

```sh
npm run check      # 服务端 + 管理页类型检查
npm test           # 构建服务端与管理页，运行集成测试
npm pack --dry-run
```

管理页源码在 `web/`（npm workspace）。开发时先 `npm start`，再运行 `npm run dev`，打开 `http://localhost:5173`；Vite 会把 `/api` 代理到本机服务。

参见 [架构](docs/architecture.md)、[竞品与定位](docs/landscape.md)、[验收](docs/acceptance.md)、[贡献说明](CONTRIBUTING.md)。

## 许可

[MIT](LICENSE)。欢迎提 issue 和 PR，提交前请阅读 [贡献说明](CONTRIBUTING.md) 与 [安全说明](SECURITY.md)。
