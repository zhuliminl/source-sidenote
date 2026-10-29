# Source Sidenote for VS Code

在 VS Code 里对照主题说明 **review** 代码。扩展只是本机服务的客户端：主题和说明由 `sidenote start` 启动的服务生成、保存，扩展通过 `127.0.0.1` 上的 HTTP 接口读取。新建主题、确认文件、故事和模型设置都在网页阅读器里完成，扩展只提供跳转。

## 功能

- **跟随编辑器**：打开一个文件，扩展查出它所在的项目和覆盖它的主题（每个工作区记住你选的主题，没选时用最新覆盖它的主题），状态栏显示当前主题，点击切换。
- **代码依据标在代码上**：有依据的代码段在左侧有一条细竖线；光标所在的那一段整段暖黄色高亮（和网页阅读器一致），鼠标悬停显示这段的依据。
- **说明面板**（`Sidenote: Show Explanation`，或编辑器标题栏的书本图标）：一句话说明、Mermaid 图（点击节点跳到对应代码，光标所在段落对应的节点高亮）、核心流程、职责、代码依据（跟随光标高亮，点击定位）、关联文件、阅读注意、AI 复查结果。
- **review 操作**：AI 复查、重新生成；显示最新/已过期、未保存修改、排队/进行中/失败状态，任务完成后通过 `/api/events` 自动刷新。
- **资源管理器里的“Sidenote 主题”视图**：当前主题的文件按阅读顺序排列，带说明状态图标，点击打开。
- **网页阅读器**：`Sidenote: Open in Web Reader` 打开同一主题、同一文件和光标所在的代码段；`Sidenote: New Topic in Web Reader` 去网页新建主题。
- 服务未运行时给出提示，服务启动后自动重连。

面板使用 VS Code 主题变量着色；Webview 的内容安全策略只允许扩展自带的脚本（以及 Mermaid 写入 SVG 的样式），模型输出以纯文本插入 DOM，图在 Mermaid 严格模式下渲染。

## 使用

1. 启动服务、注册项目，并在网页阅读器里为项目建好至少一个主题：

   ```sh
   sidenote start
   cd /path/to/project && sidenote add
   ```

2. 在 VS Code 中打开项目文件。属于某个主题的文件会自动标出代码依据；运行 `Sidenote: Show Explanation` 打开说明面板。

扩展从 `connection.json` 读取服务地址，目录依次取设置 `sidenote.home`、环境变量 `SIDENOTE_HOME`、`~/.local/share/source-sidenote`，与服务端一致。文件通过服务的 `GET /api/locate?path=` 匹配项目（realpath，最长根目录优先）。

说明针对磁盘上已保存的文件；编辑器有未保存修改时面板会提示。

## 从源码安装

需要 Node 26（与服务端相同）。在仓库根目录：

```sh
npm ci
npm run build -w editors/vscode
cd editors/vscode
npx @vscode/vsce package --no-dependencies --allow-missing-repository --skip-license
code --install-extension source-sidenote-vscode-0.1.0.vsix
```

扩展没有运行时依赖，`dist/extension.js` 和 `dist/panel.js`（含 Mermaid，约 3 MB）由 esbuild 打包。

## 开发

```sh
npm run check -w editors/vscode   # 类型检查（根目录 npm run check 也会执行）
npm run build -w editors/vscode
code --extensionDevelopmentPath="$PWD/editors/vscode" /path/to/project
```

HTTP 契约类型来自 `src/shared/api.ts`（仅类型导入），扩展与 Webview 之间的消息定义在 `src/protocol.ts`。
