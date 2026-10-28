# Source Sidenote · 源旁注

**代码旁边，多一份理解。** A local-first AI code reading service with shared, persistent explanations.

Source Sidenote 为本地项目生成简明、有代码依据的逐文件说明。独立 Node 服务管理模型、项目和生成任务；Neovim 通过轻量适配器在当前代码窗口右侧显示 Markdown。

> **0.1.0 开发预览**：尚未发布到 npm/GitHub。当前验证使用模拟模型，真实模型质量、费用和不同提供商兼容性需要实际验收。不要将 AI 复查通过当成正确性证明。

## 当前可用

- 一个本机服务管理多个项目，内置中文管理页。
- Chat Completions 兼容接口：Base URL、模型、密钥、并发、每批文件上限、超时可配置。
- `add` 自动扫描、注册、生成缺失/过期说明；重复执行复用缓存。
- 源码与上下文指纹、Markdown 说明、结构化依据、复查结果持久化。
- 文件树/README/构建配置 + 有限的 JS/TS 相对导入、Java 显式导入上下文。
- 持久化队列、单实例锁、重启恢复、取消；失败后手动重跑，不无限重试。
- 覆盖率、新鲜率、AI 复查通过比例分别展示。
- Neovim 0.10+ 右侧分屏，默认不绑定任何快捷键、不修改主题。

## 从源码运行

需要 **Node 26.12.1+（26.x）**。本项目使用内置 `node:sqlite`，该接口目前仍是 Release Candidate，因此锁定主版本。项目 Node 可用 nvm 等工具独立管理，不要修改旧业务项目的运行环境。

```sh
npm ci
npm test
npm start
```

服务默认监听 `127.0.0.1:47831`，自动打开管理页。先配置模型，然后在另一个终端：

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
sidenote explain /absolute/file [--refresh] [--wait]
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

在已 `add` 的项目中使用 `:Sidenote`、`:SidenoteRefresh`、`:SidenoteClose`。代码保留在原窗口，说明显示在右侧，焦点留在代码。说明窗口内 `q` 关闭。不会覆盖用户的 Tab、x 或其他映射。第一版针对已保存文件，未保存会提示；切换文件后再次执行命令刷新说明。

## 范围、费用与隐私

- `add` 表示同意将纳入范围的代码上下文发给已配置模型。未配置模型只扫描注册。
- 默认每次最多加入 100 个文件、并发 2 个请求、每次响应最多 3000 tokens；这是**请求范围限制，不是金额预算保证**。再次 `add` 可继续补齐。
- 排除依赖、构建产物、隐藏文件、`.env`、密钥扩展名、锁文件、压缩/生成文件、符号链接、空文件、超过 128 KiB 和非源码扩展名的文件。
- 支持根目录和子目录 `.gitignore` / `.sidenoteignore`；不承诺等同 Git 全部忽略语义。被父目录排除的子项不能重新纳入。
- 不在业务项目写入说明，不修改业务源码，不执行仓库脚本。
- 服务只监听回环地址，API 要求本机 token，并校验 Host/Origin。管理页启动授权通过 URL fragment 交接，随后清除地址栏 fragment；不要分享授权链接。
- 密钥保存在权限为 `0600` 的配置文件，**不是加密保险箱**；不会由配置查询接口回传，也不记录到模型错误日志。操作系统密钥链支持待实现。
- 数据默认在 `~/.local/share/source-sidenote`，可用 `SIDENOTE_HOME` 覆盖。目录权限 `0700`。

## 指标与限制

覆盖率 = 已有结构合格说明 / 当前扫描纳入文件。新鲜率 = 源码和当前有限上下文指纹一致的说明 / 已有说明。复查比例独立展示，不是正确率。

源文件及已知直接依赖变化可使说明过期；新增/删除文件和忽略规则变化需要重新扫描或 `add`。尚无文件系统实时监听、完整 AST/LSP 依赖图、架构摘要生成、间接依赖传播、价格统计、自动重试退避、模型连通性测试或完整资源预算。大型仓库统计目前会读取文件；需要后续增量索引优化。

浏览器当前提供 Markdown 源文本预览；浏览器代码/说明双栏阅读、VS Code 客户端、未保存快照均为后续计划。

## 开发与发布

```sh
npm run check
npm test
npm pack --dry-run
```

参见 [架构](docs/architecture.md)、[竞品与定位](docs/landscape.md)、[验收](docs/acceptance.md)、[贡献说明](CONTRIBUTING.md)。MIT License。
