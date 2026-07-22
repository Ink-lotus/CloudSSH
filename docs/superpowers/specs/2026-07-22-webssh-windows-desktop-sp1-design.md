# Web SSH · 类 Windows 桌面（基于 CloudSSH）— SP1 设计规格

- 日期：2026-07-22
- 阶段：SP1（地基 + 桌面外壳骨架）
- 基座：Fork 自 [newbietan/CloudSSH](https://github.com/newbietan/CloudSSH)（Apache-2.0）

---

## 1. 背景与目标

本仓库当前是一份纯前端、零依赖的 SSH 控制台原型（Atlas SSH Console），终端/文件/监控均为**模拟数据**，无真实 SSH 后端。

目标：做一个**网页端 SSH**，尽量跑在 Cloudflare 免费资源上，界面做成 **GMSSH 式的类 Windows 桌面**，实现四大功能：账号登录并记住多台 VPS、图形化操作界面、类 Windows 文件管理、文件传输。

**核心决策**：不从零实现 SSH。CloudSSH 已用纯 TypeScript 在 Cloudflare Worker 里实现了完整 SSH-2.0（`cloudflare:sockets`）+ SFTP + Durable Objects 会话 + GitHub OAuth + 服务器凭据加密存储，且 Apache-2.0 开源、纯 serverless。因此 **fork CloudSSH 作为后端引擎，重做前端为类 Windows 桌面**。

## 2. 子项目路线图

| 子项目 | 内容 | 依赖 |
|---|---|---|
| **SP1（本规格）** | 地基：fork+部署跑通；窗口管理器、任务栏、开始菜单、桌面图标；把现成终端/SFTP 塞进窗口 | — |
| SP2 | 类 Windows 资源管理器（目录树+列表+右键+拖拽上传下载），替换 SFTP 面板 UI | SP1 窗口系统 |
| SP3 | 打磨：主机管理体验、多终端、监控 App、设置/主题/壁纸 | SP1、SP2 |

每个子项目独立 规格 → 计划 → 实现。

## 3. SP1 范围

### 3.1 做什么（成功标准）

1. CloudSSH fork 进本仓库，能构建、能部署到 Cloudflare；GitHub 登录后能连**真实 VPS** 并执行命令。
2. **桌面外壳**替换原“三页面切换 + TabManager”模型：壁纸、桌面图标、任务栏、开始菜单、时钟。
3. **窗口管理器**：窗口可拖拽、缩放、最小化、最大化/还原、点击置顶（z-index）、关闭。
4. 连接某台服务器 → 桌面上打开一个**终端窗口**（复用 `SSHTerminal`）；可同时打开多个窗口（多台主机各一窗）。
5. 任务栏显示已打开窗口，点击可聚焦/最小化切换。
6. 桌面图标 / 开始菜单可打开“服务器”App（窗口内嵌 `ServerList`，即“记住多台 VPS”管理）。
7. SFTP 仍以终端窗口内的**现有切换面板**形式提供（可传一个文件即达标）。

### 3.2 明确不做（YAGNI）

- 类 Windows 资源管理器（SP2）。
- 监控 App、进程视图、系统信息面板。
- 窗口贴边分屏/磁吸、多虚拟桌面、窗口动画打磨、主题体系扩展。
- 登录方式改造（保持 GitHub OAuth）。
- 移动端专门适配（桌面优先；小屏可后续）。

### 3.3 已确认决策

| 决策点 | 结论 |
|---|---|
| SSH 传输架构 | Fork CloudSSH（纯 Cloudflare serverless，Worker+DO+`cloudflare:sockets`），不引入 Node 网关 |
| 登录方式 | 保留 CloudSSH 现有 GitHub OAuth（+ 可选 Turnstile），不改 |
| 匿名连接 | 保留（登录前的连接表单依旧可用，不登录直接填 IP/密码连） |
| 登录后入口 | 空桌面 + “服务器”App（图标/开始菜单打开后选机连接） |
| 构建工具栈 | 沿用 CloudSSH 的 pnpm + Vite + TypeScript + Tailwind，不换栈、不加新依赖 |
| SFTP | SP1 保留为终端窗口内切换面板；资源管理器化留给 SP2 |
| Atlas 原型 | 归档到 `legacy/` 保留，不直接删除 |

## 4. 架构

CloudSSH 部署形态：**单个 Cloudflare Worker**（`wrangler.toml` 的 `main = src/worker/index.ts`），Worker 同时托管前端静态资源（经 `scripts/build-html.js` 处理），并绑定两个 SQLite Durable Object：`SSH_SESSION`（SSHSessionDO）、`USER_DB`（UserDBDO）。SQLite 版 DO 在 Workers 免费计划可用。

SP1 只改前端，不动后端。

### 4.1 复用 / 替换 / 新增

- **原样复用**
  - 全部后端：`src/worker/**`、`src/ssh/**`、`wrangler.toml`、DO 定义、所有 `/api/*` 与 WebSocket 接口。
  - 前端组件：`SSHTerminal`（`terminal.ts`）、`SFTPPanel`（`sftp-panel.ts`）、`ServerList`（`server-list.ts`）、`ConnectionForm`（`auth-form.ts`）、`ui-feedback.ts`、主题、`ai-config.ts`（登录用户）。
- **替换**
  - `TabManager`（`tab-manager.ts`）→ 新 `WindowManager`。
  - `main.ts` 的三页面 show/hide 引导 → 桌面引导逻辑。
  - `index.html` 的三段式 body（auth / user-space / terminal）→ 登录门 + `#desktop` 根节点；保留服务器增改 modal。
- **新增前端模块**
  - `window-manager.ts`：`WindowManager` + `Window`，负责窗口边框、拖拽、缩放、最小/最大化、z 序、关闭。**对 SSH/业务零认知。**
  - `desktop.ts`：桌面外壳——壁纸、桌面图标层、任务栏、开始菜单、时钟；调 `WindowManager` 开窗，订阅其事件渲染任务栏。
  - `apps/terminal-app.ts`：连接编排——取 `wsUrl` → 开窗 → 把 `SSHTerminal` 挂进窗口 body → 绑定 `onResize → terminal.fit()`；复用 SFTP 切换与清理。
  - `apps/servers-app.ts`：开窗内嵌 `ServerList`，其 `onConnect` 转交 `terminal-app` 开终端窗。

### 4.2 组件边界（隔离与接口）

- **`WindowManager`**
  - 职责：窗口生命周期与堆叠顺序。
  - 接口：`openWindow(opts) => WindowHandle`，`opts = { title, icon, width, height, minWidth?, minHeight?, x?, y? }`。
  - 事件：`onWindowOpen/onWindowClose/onWindowFocus/onWindowMinimize`（供 Desktop 渲染任务栏）。
  - 不知道“终端/服务器”为何物。
- **`WindowHandle`**
  - `bodyEl: HTMLElement`（内容挂载点）、`focus()`、`minimize()`、`maximize()`（切换还原）、`close()`、`setTitle()`、`setDisconnected(bool)`、`onResize(cb)`、`onClose(cb)`。
- **`Desktop`**
  - 职责：渲染桌面图标 + 任务栏 + 开始菜单 + 时钟；把“打开某 App”翻译成 `WindowManager.openWindow` + 对应 app 装配。
- **App 包装层（`apps/*`）**
  - 每个 app 是“薄壳”：拿到 `WindowHandle.bodyEl`，实例化对应业务组件（`SSHTerminal` / `ServerList`），接好 resize 与清理。

判据：`WindowManager` 能脱离 SSH 单测；换掉终端内部实现不影响 `WindowManager`；Desktop 只依赖 `WindowManager` 的公开事件与接口。

## 5. 数据流（连接一台服务器）

1. 页面加载 → `GET /api/auth/me`：已登录进桌面；未登录显示匿名连接表单（`ConnectionForm`）。
2. 登录后进入空桌面（任务栏 + 桌面图标 + 时钟）。
3. 打开“服务器”App → 窗口内 `ServerList` 调 `GET /api/servers` 渲染卡片。
4. 点击某卡片“连接” → `POST /api/servers/:id/connect` → 返回 `{ wsUrl }`（含 one-time-token）。
5. `terminal-app`：`WindowManager.openWindow(...)` → `new WebSocket(wsUrl)` → 把 `SSHTerminal` 挂到 `bodyEl` → `terminal.connectWithWebSocket(ws, hostInfo)`。
6. `SSHTerminal` 触发 `sessionReady` → 初始化该窗口的 `SFTPPanel`（`() => terminal.getSFTPWebSocketUrl()`），窗口工具栏出现 SFTP 切换按钮。
7. 窗口缩放/最大化/还原 → `WindowHandle.onResize` → `terminal.fit()`。
8. 关闭窗口 → 清理：`sftpPanel.dispose()`、`terminal.disconnect()`、`terminal.dispose()`、关闭 WS（镜像现有 `TabManager.closeTab` 的清理，防止句柄/连接泄漏）。

匿名连接：`ConnectionForm` 走原有匿名流程得到 `wsUrl`，同样交给 `terminal-app` 开窗。

## 6. 复用的后端接口清单（SP1 不改）

- `GET /api/auth/me`、`POST /api/auth/logout`
- `GET /api/servers`、`POST /api/servers`、`PUT /api/servers/:id`、`DELETE /api/servers/:id`
- `POST /api/servers/:id/connect` → `{ wsUrl }`
- `GET /api/user/theme`、`PUT /api/user/theme`
- WebSocket：SSH 会话（`wsUrl` 内含 one-time-token）；SFTP 会话（`terminal.getSFTPWebSocketUrl()`）

## 7. 错误处理

- 保留 `validateWsUrl`：拒绝非同源/非 ws(s) 地址，非法则 `notify` 报错、不开窗。
- 连接失败 / 会话中途断开：复用 `SSHTerminal` 的 `sessionClosed` 回调；窗口标题与任务栏项显示“已断开”视觉（沿用现有 tab 断开态样式），并清理 SFTP 面板。
- 关窗清理必须完整，避免多窗场景下的 WebSocket / DO 会话泄漏。
- 保留 CloudSSH 的独立终端标签页模式（`?wsUrl=` 直连）代码路径不破坏，作为备用；SP1 桌面不依赖它。

## 8. 验证策略

- **构建/类型**：`pnpm install` → `pnpm build`（前端 Vite + build-html）→ `wrangler deploy --dry-run`（或 `tsc --noEmit`）通过。
- **单元测试**（保持现有测试栈，避免新依赖）：
  - `WindowManager` 置顶：聚焦窗口后其 z-index 最大。
  - 任务栏同步：开/关/最小化窗口时任务栏项数量与状态正确。
  - 拖拽边界钳制：窗口位置计算不越出视口。
- **部署后手测清单**：
  1. GitHub 登录成功，进入桌面。
  2. “服务器”App 增加一台真实 VPS 并保存（验证“记住多台 VPS”）。
  3. 连接 → 终端窗口连上真实 VPS，执行 `ls`/`uptime` 有输出。
  4. 同时打开两台主机的终端窗口，互不干扰。
  5. 窗口拖拽、缩放、最小化、最大化/还原、关闭均正常；任务栏切换正常。
  6. 终端窗口切到 SFTP，上传并下载一个文件成功。
  7. 匿名连接（不登录填 IP/密码）仍可开终端窗口。

## 9. 风险与实现期需验证的假设

1. **`SFTPPanel` 能否在窗口容器内正常渲染**：它当前是与 `terminal-section` 关联的切换面板；需确认其挂载点能落到窗口 body 内而非全局固定层。实现首步先读 `sftp-panel.ts` 确认，必要时给它传入容器。
2. **`SSHTerminal.fit()` 在窗口频繁 resize 下的表现**：xterm fit 需要容器有确定尺寸；窗口拖拽缩放时按帧/防抖调用 `fit()`。
3. **Cloudflare 免费额度**：长时间 SSH 会话对 Workers/DO 时长的消耗；个人自用一般在免费额度内，但需在 README 注明额度与超限可能。
4. **前端构建产物如何被 Worker 托管**：以 CloudSSH 现有 `scripts/build-html.js` 与 `src/worker/html.ts` 为准，改造 `index.html`/入口时不破坏该管线。

## 10. 许可与署名

CloudSSH 为 Apache-2.0。Fork/修改需：保留其 `LICENSE`、`NOTICE`（如有），在本项目 README 注明基于 CloudSSH 二次开发并链接原仓库，遵守 Apache-2.0 署名与变更声明要求。

## 11. 仓库落地方式（SP1 起手，属实现计划范畴，此处仅记方向）

- 将现有 Atlas 原型（`index.html`、`src/app.js`、`src/data.js`、`styles.css`、`server.mjs`、`tests/`）移入 `legacy/` 归档。
- 引入 CloudSSH 源码（`frontend/`、`src/worker/`、`src/ssh/`、`wrangler.toml`、`package.json`、`pnpm-*` 等）作为新基座。
- 在 `frontend/src/` 下新增 `window-manager.ts`、`desktop.ts`、`apps/` 并改造 `index.html` 与 `main.ts`。

具体步骤、顺序与验证点在 writing-plans 阶段展开。
