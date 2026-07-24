# UX 打磨：匿名直入桌面 + 设置增强 + 终端体验优化

> **日期：** 2026-07-24
> **范围：** 前端 4 项改进，后端不动
> **前置：** SP1 桌面外壳 + 移动端外壳已完成

---

## 概述

本次迭代包含 5 个紧密关联的前端改进，目标是消除匿名用户的登录门槛，将分散的设置项收归系统设置，并提升终端连接和交互体验。

| # | 功能 | 关键改动 |
|---|------|----------|
| 1 | 匿名直入桌面 | 所有用户跳过登录页直接进入桌面，删除旧 auth-section |
| 2 | 服务器 App 双模式 | 匿名用户看到精简快速连接表单（含 Turnstile），登录用户看到完整服务器管理 |
| 3 | 设置 App 增强 | 新增 GitHub 账户登录/登出 + 语言下拉菜单（含"自动"选项） |
| 4 | 终端连接状态覆盖层 | 用 DOM 覆盖层替代 ANSI Banner，解决小窗口下状态信息不可见 |
| 5 | 终端右键智能复制/粘贴 | 有选区 → 复制，无选区 → 粘贴 |

---

## §1 应用入口重构 —— 所有用户直接进桌面

### 现状

`main.ts#init()` 调用 `GET /api/auth/me`，登录用户走 `showDesktop(user)`，未登录走 `showAuthSection()` 显示 `ConnectionForm`。

### 目标行为

- `init()` 始终调用 `showDesktop()`，不再分流
- `/api/auth/me` 仍调用，但仅用于获取用户信息（决定 Servers App 显示模式、Settings App 登录状态），返回值可为 `null`
- 桌面图标注册：匿名和登录用户都看到"服务器"和"设置"两个图标

### 启动流程

```
init()
  → restoreTheme()
  → initI18n()
  → GET /api/auth/me → user: User | null
  → showDesktop(user)
  → 注册 Apps: 服务器(user), 设置(user)
```

### 删除项

- `showAuthSection()` 函数
- `index.html` 中的 `#auth-section` 及其全部子 DOM（登录表单、Turnstile 容器、语言切换按钮、GitHub 登录按钮）
- `auth-form.ts`（`ConnectionForm` 类）—— 其功能分拆到 Servers App 和独立 Turnstile 模块
- `index.html` 中服务器列表 header 里的 `[data-language-switcher]` 容器

---

## §2 服务器 App —— 匿名/登录双模式

### 匿名模式（`user === null`）

打开"服务器" App 时，窗口内显示精简的快速连接表单：

**表单字段：**
- 主机地址（host）
- 端口（port，默认 22）
- 用户名（username）
- 认证方式切换（密码 / 私钥，Tab 切换）
- 私钥支持文件上传
- 连接区域选择（可选）
- Turnstile 验证控件（启用时显示）
- "记住连接信息"复选框

**Turnstile 集成：**
- 从 `/api/config` 获取 `turnstileEnabled` + `sitekey`
- 启用时在表单底部渲染 Turnstile 控件
- 通过验证后调用 `POST /api/verify` 获取 `cf_verified` cookie
- 连接前校验 `turnstileVerified` 状态

**最近连接记录：**
- 复用现有 `localStorage` 加密存储逻辑（PBKDF2 + AES-256-GCM）
- 表单上方显示最近连接列表（最多 5 条），点击回填表单字段

**连接流程：**
1. 校验必填字段（host、username、credential）
2. Turnstile 校验（若启用）
3. 保存/更新最近连接记录到 `localStorage`
4. 创建终端窗口（通过窗口管理器）
5. WebSocket 直连 `/api/ssh`

**不显示的元素：** 无用户头像、无退出按钮、无服务器卡片网格。

### 登录模式（`user !== null`）

与现有行为完全一致：用户头像 + 服务器卡片网格 + 添加/编辑/删除/连接。不显示 Turnstile（登录用户已通过 OAuth 认证）。

### 代码组织

- **新建 `frontend/src/turnstile.ts`**：从 `auth-form.ts` 提取 Turnstile 渲染/验证逻辑为独立模块，导出 `checkTurnstileConfig()`、`renderTurnstile(container)`、`isTurnstileVerified()` 等
- **`servers-app.ts`**：`openServersWindow()` 参数改为 `user: User | null`，根据 `user` 是否为 null 选择渲染匿名表单或 `ServerList`
- **新建 `frontend/src/credential-store.ts`**：将 `auth-form.ts` 中的 `deriveKey`/`encrypt`/`decrypt` 及最近连接记录的读写逻辑提取为公共模块，供匿名表单复用

### 后端无改动

所有 API 路由（`/api/config`、`/api/verify`、`/api/ssh`）和 Turnstile 验证逻辑（`TURNSTILE_SECRET`、`TURNSTILE_SITEKEY` 环境变量）保持不变。Turnstile SDK 的 `<script>` 标签在 `index.html` 中保留。

---

## §3 设置 App 增强 —— GitHub 账户 + 语言切换

### 现状

设置 App 只有"显示模式"三按钮和"主题/壁纸"占位。GitHub 登录按钮在旧 auth-section（将删除），语言切换在旧 auth-section header 和服务器列表 header 里。

### 目标布局（自上而下）

#### 1. 账户

- **未登录（`user === null`）：** 显示"登录 GitHub"按钮，点击跳转 `/api/auth/github` OAuth 流程。无 Turnstile。
- **已登录（`user !== null`）：** 显示 GitHub 头像 + 用户名 + "退出登录"按钮。退出登录调用 `POST /api/auth/logout`，成功后：关闭所有已打开的窗口（终端连接、服务器管理等），将全局 `user` 置为 `null`，桌面回到匿名初始状态。

#### 2. 语言

- **下拉菜单**，选项列表：
  - `自动` — 读取 `navigator.languages` 匹配已支持的语言，无匹配则回退 English
  - `简体中文`
  - `English`
  - （未来新增语言只需在 `i18n/locales/` 添加文件并在此列表注册）
- **"自动"选中时**，下拉菜单显示文本为 `自动 (简体中文)` 或 `Auto (English)`，括号内显示实际生效的语言
- **持久化：** `localStorage` 存储用户选择：`auto` / `zh-CN` / `en-US`
- **切换立即生效：** 调用 `setLocale()`，触发 `translateDocument()` 全局刷新
- **与现有 `resolveLocale()` 的关系：** 当值为 `auto` 时走浏览器语言检测分支（已有逻辑），指定语言时直接使用

#### 3. 显示模式（保留现有）

自动 / 桌面 / 移动 三按钮，不变。

#### 4. 主题 / 壁纸（保留占位，SP3）

### 清理项

- `i18n/index.ts` 的 `mountLanguageSwitchers()` 函数可删除（`[data-language-switcher]` DOM 容器已在 §1 删除项中移除）

---

## §4 终端连接状态 —— DOM 覆盖层替代 ANSI Banner

### 现状

`showConnectingBanner()` 用固定 34 列宽的 ANSI 字符画写入 xterm 缓冲区。后续状态行（`[+] 正在发送凭据...`、`[*] 密钥交换完成` 等）也 `term.write()` 写入。小窗口下列数不足导致 Banner 换行错乱，用户看到黑屏。

### 覆盖层结构

在终端容器（`mountEl`，`position:absolute;inset:0`）内叠加一个 `<div>`：

```
正在连接 cloudssh...    ← "..." 循环动画（setInterval 切换 . → .. → ... → .）
websocket 已连接
正在发送凭据...
密钥交换完成
```

- 居中对齐，主状态文字 + 逐行追加的详细进度
- 背景：半透明深色，覆盖 xterm 黑屏区域
- 文字 CSS 自动换行，任何窗口尺寸都可读
- 循环 `...` 动画：`setInterval` 在文本节点上切换 `.` → `..` → `...` → `.`，无额外 DOM 元素和 `@keyframes`

### 生命周期

| 时机 | 动作 |
|------|------|
| `connect()` 调用 | 创建覆盖层，显示"正在连接 {host}..." |
| WebSocket `onopen` | 追加"正在发送凭据..." |
| 收到 `type: 'status'` 消息 | 追加对应国际化文本行 |
| 收到 `shell_ready` | 覆盖层淡出移除（CSS `opacity` transition，约 300ms） |
| 连接失败 / 断开 | 覆盖层显示错误信息 + 红色文字，保留直到重连或关闭 |
| 自动重连 | 复用覆盖层，显示"等待重连 (N秒)..."，重连发起后回到"正在连接..."状态 |

### 删除项

- `showConnectingBanner()` 方法
- `resetTerminalDisplay()` 中的 Banner 清屏逻辑
- `terminal-text.ts`（`centerTerminalText` 仅被 Banner 使用）
- 状态行不再 `term.write()`，终端缓冲区从连接成功后才有内容

---

## §5 终端右键智能复制/粘贴

### 现状

`terminal.ts` 第 210-221 行，`contextmenu` 事件一律执行粘贴。

### 目标行为

```
右键点击
  ├─ terminal.getSelection() 非空
  │   → navigator.clipboard.writeText(selection)
  │   → terminal.clearSelection()  // 视觉反馈：选中高亮消失 = 已复制
  └─ terminal.getSelection() 为空
      → navigator.clipboard.readText() → ws.send()  // 保持现有粘贴行为
```

- 使用 xterm.js 自带的 `terminal.getSelection()` 检测终端内选区
- 复制后自动清除选区
- 粘贴逻辑完全不变
- 无自定义右键菜单 DOM，保持"右键即操作"交互

---

## 影响范围

### 新建文件

| 文件 | 用途 |
|------|------|
| `frontend/src/turnstile.ts` | Turnstile 渲染/验证独立模块 |
| `frontend/src/credential-store.ts` | 凭据加密存储（deriveKey/encrypt/decrypt）+ 最近连接记录读写 |

### 修改文件

| 文件 | 改动摘要 |
|------|----------|
| `frontend/src/main.ts` | 删除分流逻辑，始终 `showDesktop(user)`，`user` 可为 null |
| `frontend/src/apps/servers-app.ts` | `user` 参数改为可空，匿名/登录双模式 |
| `frontend/src/server-list.ts` | 仅登录模式使用，接口不变 |
| `frontend/src/apps/settings-app.ts` | 新增账户区（登录/登出）、语言下拉菜单 |
| `frontend/src/terminal.ts` | 删除 ANSI Banner，新增 DOM 覆盖层；修改右键事件为智能复制/粘贴 |
| `frontend/src/i18n/index.ts` | 调整 `resolveLocale()` 支持 `auto` 值，可删除 `mountLanguageSwitchers()` |
| `frontend/index.html` | 删除 `#auth-section` 及相关 DOM |

### 删除文件

| 文件 | 原因 |
|------|------|
| `frontend/src/auth-form.ts` | ConnectionForm 功能分拆到 Servers App + Turnstile 模块 |
| `frontend/src/terminal-text.ts` | `centerTerminalText` 仅被 Banner 使用，Banner 已移除 |

### 不动的部分

- 后端所有代码（`src/worker/`、`src/ssh/`）
- 所有 API 路由和 Turnstile 后端验证逻辑
- Cloudflare Worker 环境变量
- 测试文件（需新增/更新，在实现计划中确定）
- 窗口管理器核心（`wm/`）、Shell 框架（`shell/`）
