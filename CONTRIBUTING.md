# 参与开发

使用 .nvmrc 指定的 Node，执行 npm ci、npm test。业务逻辑放 application/domain，不在编辑器重复实现模型调用或缓存。

提交前检查 npm pack --dry-run 的文件列表；不得提交 token、config.json、数据库、真实业务源码或模型请求日志。新增模型协议需提供模拟服务集成测试。使用小型公开/合成项目复现问题。

Git 提交主题建议：`【修复】【任务队列】【避免重复入队】【已验证】`。不要在公共 issue 中粘贴密钥或包含私有源码的响应。
