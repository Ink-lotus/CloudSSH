# Atlas SSH Console

日期：2026-07-20  
执行者：Codex

Atlas SSH Console 是一套受现代桌面运维工具启发的图形化 SSH 管理面板。当前版本是零依赖、可直接运行的高保真前端，包含主机分组、状态指标、交互式终端演示、文件管理、性能监控、进程视图和新建连接流程。

## 本地运行

要求 Node.js 18 或更高版本。

```bash
npm start
```

打开 `http://127.0.0.1:4173`。

## 验证

```bash
npm run check
npm test
```

## 已实现交互

- 按分组、名称、IP 和标签筛选主机。
- 切换主机并同步更新状态、指标和终端上下文。
- 在终端中执行 `help`、`uptime`、`df -h`、`docker ps`、`last -n 5`、`uname -a`、`whoami`、`pwd`、`ls -la` 和 `clear`。
- 切换终端、文件、监控与进程工作区。
- 使用密码或密钥方式添加演示连接，并完成字段校验。
- 支持 `/` 聚焦搜索、`Ctrl/Cmd + K` 新建连接、`Esc` 关闭弹窗。
- 支持桌面、平板和移动端响应式布局。

## 接入真实 SSH 的后端契约

浏览器不能直接建立 SSH TCP 连接。生产版本应增加受控的服务端 SSH 网关，并将前端的演示执行层替换为以下接口：

1. `POST /api/connections`：接收主机、端口、用户名和认证材料，完成主机密钥校验后返回短期 `sessionId`。
2. `GET /api/connections/:sessionId/status`：返回连接状态与服务器基础信息。
3. `WS /api/ssh/:sessionId`：双向传输终端输入、标准输出、窗口尺寸与关闭事件。
4. `GET /api/sftp/:sessionId/files?path=/...`：读取目录；上传、下载、重命名与删除使用独立的受控端点。
5. 指标、进程和服务状态通过同一会话内的受限命令适配器采集。

当前页面不会发送或持久化用户在新建连接弹窗中输入的凭据。

## 目录

```text
.
├── index.html
├── styles.css
├── server.mjs
├── src/
│   ├── app.js
│   └── data.js
├── tests/
└── .codex/
```
