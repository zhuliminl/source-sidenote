# Source Sidenote · 源旁注

**代码旁边，多一份理解。** A local-first AI code reading service with shared, persistent explanations.

Source Sidenote 按**主题**帮你读懂本地项目：描述你想弄懂的功能或链路，AI 先挑出相关文件，你确认后才逐个生成有代码依据的说明，最后写一份把这些文件串起来的链路导读。不必为了读懂一条链路而解释整个仓库。独立 Node 服务管理模型、项目和生成任务；Neovim 通过轻量适配器在当前代码窗口右侧显示 Markdown。

> **0.1.0 开发预览**：尚未发布到 npm/GitHub。当前验证使用模拟模型，真实模型质量、费用和不同提供商兼容性需要实际验收。不要将 AI 复查通过当成正确性证明。

## 当前可用

- 一个本机服务管理多个项目，内置中文管理页（React + Vite + shadcn/ui，浅色/深色，支持手机宽度）。
- Chat Completions 兼容接口：Base URL、模型、密钥、并发、每个主题的文件上限、超时可配置。
- 主题流程：描述主题（可加补充要求）→ AI 规划文件与阅读顺序 → 你增删、排序并确认 → 逐文件生成说明 → 链路导读。确认前不会把源码发给模型。主题可删除并重新创建。
- 所有系统提示词在管理页“提示词”中原样展示；补充要求会追加在提示词末尾，确认前可以预览。
- 添加项目时可点文件夹图标，由服务弹出系统的文件夹选择框（macOS / Windows；Linux 需 zenity 或 kdialog），也可粘贴绝对路径。`add` 只扫描并注册项目，不调用模型。
- 源码与上下文指纹、Markdown 说明、结构化依据、复查结果持久化。
- 文件树/README/构建配置 + 有限的 JS/TS 相对导入、Java 显式导入上下文。
- 持久化队列、单实例锁、重启恢复、取消；失败后手动重跑，不无限重试。
- 覆盖率 = 至少被一个主题解释的文件 / 扫描纳入的文件；每个主题单独显示最新说明数量。
- Neovim 0.10+ 右侧分屏，默认不绑定任何快捷键、不修改主题。

## 从源码运行

需要 **Node 26.12.1+（26.x）**。本项目使用内置 `node:sqlite`，该接口目前仍是 Release Candidate，因此锁定主版本。项目 Node 可用 nvm 等工具独立管理，不要修改旧业务项目的运行环境。

```sh
npm ci
npm test
npm start
```

服务默认监听 `127.0.0.1:47831`，自动打开管理页。先配置模型，再添加项目、新建主题。也可以在另一个终端注册项目：

```sh
# 尚未发布时，使用本地项目里的 CLI（路径请按实际安装位置修改）
cd /path/to/business-project
node /path/to/source-sidenote/dist/cli/main.js add
```

`start` 默认前台运行，关闭终端会结束服务；任务会保留。发布后的目标用法：

```sh
npx source-sidenote start
# 另一终端进入项目
npx source-sidenote add
```

也可 `npm link` 后使用 `sidenote`。`npx` 不会安装所需 Node 运行时。

```text
sidenote start [--no-open] [--port 47831]
sidenote ui
sidenote status
sidenote projects
sidenote add [directory]
sidenote explain /absolute/file [--topic id]
sidenote stop
```

## Neovim

把本仓库的 `editors/neovim` 加入 runtimepath（或将它作为本地插件加载）：

```lua
vim.opt.runtimepath:append('/path/to/source-sidenote/editors/neovim')
require('sidenote').setup({
  -- npm link 后可用 { 'sidenote' }；也可指定独立 Node 和 CLI 绝对路径
  command = { '/path/to/node26', '/path/to/source-sidenote/dist/cli/main.js' },
  width = 52,
})
```

使用 `:Sidenote` 显示当前文件在最新主题中的说明；文件属于多个主题时用 `:SidenoteTopic` 切换；`:SidenoteClose` 关闭。说明在管理页按主题生成，编辑器只负责查看。代码保留在原窗口，说明显示在右侧，焦点留在代码。说明窗口内 `q` 关闭。不会覆盖用户的 Tab、x 或其他映射。第一版针对已保存文件，未保存会提示；切换文件后再次执行命令刷新说明。

## 范围、费用与隐私

- 规划只发送文件路径清单（最多 2000 项）和 README/构建清单；你确认文件清单后，才发送这些文件的源码及其直接依赖片段。
- 默认每个主题最多 15 个文件、并发 2 个请求、每次响应最多 3000 tokens；一个主题约调用模型“文件数 + 2”次（规划 + 每个文件 + 导读）。这是**请求范围限制，不是金额预算保证**。
- 排除依赖、构建产物、隐藏文件、`.env`、密钥扩展名、锁文件、压缩/生成文件、符号链接、空文件、非 UTF-8 编码（如 GBK）、超过 128 KiB 和非源码扩展名的文件。
- 支持根目录和子目录 `.gitignore` / `.sidenoteignore`；不承诺等同 Git 全部忽略语义。被父目录排除的子项不能重新纳入。
- 不在业务项目写入说明，不修改业务源码，不执行仓库脚本。
- 服务只监听回环地址（127.0.0.1），无需登录；通过严格校验 Host/Origin 阻止网页跨站访问和 DNS 重绑定。本机其他进程可以访问服务，与其他本地开发工具一样。
- 密钥保存在权限为 `0600` 的配置文件，**不是加密保险箱**；不会由配置查询接口回传，也不记录到模型错误日志。操作系统密钥链支持待实现。
- 数据默认在 `~/.local/share/source-sidenote`，可用 `SIDENOTE_HOME` 覆盖。目录权限 `0700`。

## 指标与限制

覆盖率 = 至少被一个已确认主题解释的文件 / 当前扫描纳入文件。说明归属于主题：同一个文件在不同主题里围绕不同链路解释，删除主题会一并删除它的说明。AI 复查结果单独展示，不是正确率。

源文件、已知直接依赖、提示词版本或所配置模型变化会使说明过期，可在主题里一键更新；文件清单和 README/构建文件只用于规划，修改它们不会让说明过期；新增/删除文件和忽略规则变化需要重新扫描或 `add`。尚无文件系统实时监听、完整 AST/LSP 依赖图、架构摘要生成、间接依赖传播、价格统计、自动重试退避、模型连通性测试或完整资源预算。规划只看文件路径和 README，大仓库中可能漏选文件，可在确认前手动添加。

管理页是完整的阅读器：顶部切换主题；左侧是主题的阅读顺序，或按真实目录展示的文件树（标出主题文件或覆盖情况）；中间是语法高亮源码（Shiki，按需加载语言），右侧是该文件在当前主题下的说明；点击“代码依据”会在源码中定位并高亮对应行，关联文件可直接跳转，链接 `?topic=…&file=…&lines=12-30` 可分享。窄屏下源码/说明切换为标签页。未保存快照为后续计划。

## 开发与发布

```sh
npm run check      # 服务端 + 管理页类型检查
npm test           # 构建服务端与管理页，运行集成测试
npm pack --dry-run
```

管理页源码在 `web/`（npm workspace）。开发时先 `npm start`，再运行 `npm run dev`，打开 `http://localhost:5173`；Vite 会把 `/api` 代理到本机服务。

参见 [架构](docs/architecture.md)、[竞品与定位](docs/landscape.md)、[验收](docs/acceptance.md)、[贡献说明](CONTRIBUTING.md)。MIT License。
