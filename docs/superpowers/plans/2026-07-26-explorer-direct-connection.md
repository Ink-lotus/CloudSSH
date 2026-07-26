# 资源管理器统一直接连接实施计划

> 面向实施者：按任务顺序执行；功能与修复代码必须遵循 TDD，先观察针对性测试
> 失败，再写最小实现。每个任务单独提交到 `test` 分支。

**目标：** 让匿名用户通过直接 SSH 连接使用完整资源管理器，同时让登录用户可在
已保存服务器和直接连接之间选择；两条路径复用同一连接池、标签和 SFTP UI。

**设计依据：**
`docs/superpowers/specs/2026-07-26-explorer-direct-connection-design.md`

**技术边界：** 不修改 Worker API、Durable Object、SSH/SFTP 协议、环境变量或
`wrangler.toml`。`/api/servers` 继续要求登录。直接连接复用现有 `/api/ssh`、
Turnstile、限流、DNS 检查和 TOFU。

**测试环境：** Vitest 使用 Node 环境，无 jsdom。DOM 组件本身通过前端严格类型
检查、构建和人工验证覆盖；可抽离的决策与校验必须写成纯函数单测。

---

## 文件变更总览

### 新建

| 文件 | 职责 |
|------|------|
| `frontend/src/explorer/connection-target.ts` | 统一 target/request/key 类型及构造函数 |
| `frontend/src/shared/connection-input.ts` | SSH 连接草稿解析与纯校验 |
| `frontend/src/apps/ssh-connection-form.ts` | 可复用的直接连接表单 |
| `tests/explorer/connection-target.test.ts` | 保存/直接连接目标与 key 测试 |
| `tests/explorer/connection-input.test.ts` | 表单解析与校验测试 |
| `tests/explorer/connection-strategy.test.ts` | 保存/直接 SSH 策略及 attach 等待测试 |
| `tests/explorer/connection-picker.test.ts` | 匿名/登录选择器状态测试 |
| `tests/explorer/terminal-open-strategy.test.ts` | 保存/直接来源的终端打开分派测试 |

### 主要修改

| 文件 | 变更 |
|------|------|
| `frontend/src/explorer/connection-pool.ts` | 字符串 key、双连接策略、失败清理、request 保留 |
| `frontend/src/explorer/explorer-state.ts` | `serverId` 改为 `connectionKey` |
| `frontend/src/explorer/explorer-actions.ts` | 按统一 request 调用终端与跨连接操作 |
| `frontend/src/explorer/tab-manager.ts` | 接受 request，按 connectionKey 引用计数 |
| `frontend/src/explorer/server-picker.ts` | 升级为保存服务器 + 直接连接选择器 |
| `frontend/src/explorer/desktop-explorer.ts` | 统一 target 目录树和连接操作 |
| `frontend/src/explorer/mobile-explorer.ts` | 统一 target 切换与直接连接入口 |
| `frontend/src/apps/quick-connect.ts` | 改为复用 `SSHConnectionForm` 的薄包装 |
| `frontend/src/apps/explorer-app.ts` | 登录态、统一 request、直接连接、拖出窗口 |
| `frontend/src/apps/terminal-app.ts` | 支持从直接 config 打开带初始命令的终端 |
| `frontend/src/main.ts` | 向资源管理器传入登录态 |
| `frontend/src/i18n/locales/zh-CN.ts` | 直接连接与登录过期文案 |
| `frontend/src/i18n/locales/en-US.ts` | 英文对应文案 |
| `tests/explorer/*.test.ts` | 现有数字 serverId 断言迁移为字符串 key |
| `src/worker/html.ts` | 最终由 `pnpm run build:frontend` 自动生成 |

---

## 任务 1：建立统一连接目标模型

**文件：**

- 新建：`frontend/src/explorer/connection-target.ts`
- 新建：`tests/explorer/connection-target.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖以下行为：

1. 保存服务器映射成 `key: 'saved:7'`、`source: 'saved'`，连接说明只含
   `serverId: 7`。
2. 直接配置在注入 ID `abc` 时生成 `key: 'direct:abc'`。
3. `ExplorerTarget` 不包含 `password`、`privateKey` 或完整 config。
4. 直接连接默认名称为 `username@host`，非 22 端口显示
   `username@host:port`。

运行：

```bash
npx vitest run tests/explorer/connection-target.test.ts
```

预期：新模块不存在或新构造函数不存在，测试失败。

- [ ] **步骤 2：编写最小模型实现**

在 `connection-target.ts` 定义并导出：

- `ExplorerConnectionKey`
- `ExplorerTarget`
- `ExplorerConnectSpec`
- `ExplorerConnectionRequest`
- `requestFromSavedServer(server)`
- `requestFromDirectConfig(config, id?)`
- `directTargetName(config)`

`requestFromDirectConfig` 默认使用 `crypto.randomUUID()`，测试通过注入 `id`
保持确定性。`server-data.ts` 继续只负责 API DTO，不需要修改，也不存储直接连接
凭据。

- [ ] **步骤 3：运行针对性测试通过**

```bash
npx vitest run tests/explorer/connection-target.test.ts
```

- [ ] **步骤 4：提交**

```bash
git add frontend/src/explorer/connection-target.ts tests/explorer/connection-target.test.ts
git commit -m "refactor(explorer): 引入统一连接目标模型"
```

---

## 任务 2：把资源管理器身份从数字 ID 迁移为连接 key

**文件：**

- 修改：`frontend/src/explorer/connection-pool.ts`
- 修改：`frontend/src/explorer/explorer-state.ts`
- 修改：`frontend/src/explorer/explorer-actions.ts`
- 修改：`frontend/src/explorer/tab-manager.ts`
- 修改：`frontend/src/explorer/desktop-explorer.ts`
- 修改：`frontend/src/explorer/mobile-explorer.ts`
- 修改：`frontend/src/apps/explorer-app.ts`
- 修改：`tests/explorer/ref-counter.test.ts`
- 修改：`tests/explorer/explorer-state.test.ts`
- 修改：`tests/explorer/tab-logic.test.ts`
- 修改：`tests/explorer/actions-pure.test.ts`

- [ ] **步骤 1：先迁移测试断言并观察失败**

把现有 `1`、`2` 等服务器身份改为 `saved:1`、`saved:2`，新增断言：

- `ConnectionRefCounter` 对字符串 key 独立计数。
- `ExplorerState.connectionKey` 保存字符串 key。
- 剪贴板来源字段为 `sourceConnectionKey`。
- 标签关闭按 connectionKey release。

```bash
npx vitest run tests/explorer/ref-counter.test.ts tests/explorer/explorer-state.test.ts tests/explorer/tab-logic.test.ts tests/explorer/actions-pure.test.ts
```

预期：构造参数、字段名或计数器类型不匹配，测试失败。

- [ ] **步骤 2：完成类型迁移**

统一重命名：

- `serverId` → `connectionKey`
- `sourceServerId` → `sourceConnectionKey`
- `Map<number, ...>` → `Map<ExplorerConnectionKey, ...>`
- `connectedIds` → `connectedKeys`

`PooledConnection` 暂时仍只执行保存服务器策略，但改为保存
`ExplorerConnectionRequest` 和 `target`。本任务不加入直接连接分支。

- [ ] **步骤 3：运行测试和前端类型检查**

```bash
npx vitest run tests/explorer
cd frontend && pnpm exec tsc --noEmit
```

预期：全部通过，无残留数字连接身份类型错误。

- [ ] **步骤 4：扫描旧字段**

```bash
rg -n "serverId|sourceServerId|connectedIds|Map<number" frontend/src/explorer frontend/src/apps/explorer-app.ts tests/explorer
```

预期：只允许保存服务器连接说明中的 `serverId`；资源管理器状态和池中无旧身份
字段。

- [ ] **步骤 5：提交**

```bash
git add frontend/src/explorer/connection-pool.ts frontend/src/explorer/explorer-state.ts frontend/src/explorer/explorer-actions.ts frontend/src/explorer/tab-manager.ts frontend/src/explorer/desktop-explorer.ts frontend/src/explorer/mobile-explorer.ts frontend/src/apps/explorer-app.ts tests/explorer/ref-counter.test.ts tests/explorer/explorer-state.test.ts tests/explorer/tab-logic.test.ts tests/explorer/actions-pure.test.ts
git commit -m "refactor(explorer): 连接身份迁移为字符串键"
```

---

## 任务 3：提取可复用 SSH 连接表单

**文件：**

- 新建：`frontend/src/shared/connection-input.ts`
- 新建：`frontend/src/apps/ssh-connection-form.ts`
- 修改：`frontend/src/apps/quick-connect.ts`
- 新建：`tests/explorer/connection-input.test.ts`

- [ ] **步骤 1：为纯解析和校验写失败测试**

覆盖：

- 去除 IPv6 输入外层方括号。
- 空端口回退 22；端口必须为 1–65535 的整数。
- 主机和用户名必填。
- password 模式要求密码，publickey 模式要求私钥。
- 输出 `SSHConnectionConfig` 不包含“记住连接”等 UI 字段。

```bash
npx vitest run tests/explorer/connection-input.test.ts
```

预期：模块不存在，测试失败。

- [ ] **步骤 2：实现纯逻辑并使测试通过**

创建 `ConnectionDraft`、`ConnectionValidationResult`、
`parseConnectionDraft()`。错误使用稳定错误码，由 UI 映射为 i18n 文案，避免纯
逻辑依赖 DOM 或翻译模块。

- [ ] **步骤 3：提取 `SSHConnectionForm`**

从 `QuickConnectForm` 移动以下职责：

- 表单渲染和认证方式切换。
- Turnstile 初始化和提交前检查。
- 私钥文件读取。
- 最近连接读取、填充和删除。
- 用户主动勾选后的加密凭据保存。
- 调用注入的 `onSubmit(config, meta)`，不创建终端窗口。

`QuickConnectForm` 保留现有公开构造接口，在 `onSubmit` 中调用
`createTerminalWindow()` 和 `terminal.connect()`，确保服务器 App 行为不变。

- [ ] **步骤 4：运行测试与构建**

```bash
npx vitest run tests/explorer/connection-input.test.ts tests/credential-store.test.ts
cd frontend && pnpm run build
```

- [ ] **步骤 5：提交**

```bash
git add frontend/src/shared/connection-input.ts frontend/src/apps/ssh-connection-form.ts frontend/src/apps/quick-connect.ts tests/explorer/connection-input.test.ts
git commit -m "refactor(auth): 提取可复用 SSH 连接表单"
```

---

## 任务 4：连接池支持保存与直接 SSH 策略

**文件：**

- 修改：`frontend/src/explorer/connection-pool.ts`
- 新建：`tests/explorer/connection-strategy.test.ts`

- [ ] **步骤 1：设计可测试的连接边界并写失败测试**

从池中抽出不依赖 DOM 的策略函数或向池注入最小依赖接口。测试替身应能记录：

- 保存请求调用 `connectServerWs(serverId)` 和
  `terminal.connectWithWebSocket()`，不调用 `terminal.connect()`。
- 直接请求调用 `loadKnownFingerprint()` 和 `terminal.connect(config)`，不调用
  `/api/servers/:id/connect`。
- 指纹被合并到 `expectedFingerprint`。
- 凭据不出现在 target、连接 key 或抛出的错误中。

```bash
npx vitest run tests/explorer/connection-strategy.test.ts
```

预期：直接策略和注入边界不存在，测试失败。

- [ ] **步骤 2：实现双策略主连接**

`ConnectionPool.connect(request)`：

1. 按 `target.key` 复用现有或进行中的连接。
2. 创建唯一隐藏挂载节点，ID 不直接拼接未经清理的 key。
3. 保存来源走 one-time token 路径。
4. 直接来源走 `terminal.connect(config)`。
5. session ready 后进入公共 SFTP 初始化。
6. 成功后才写入 pool；失败则释放 terminal、SFTP、挂载节点和 connecting 项。

- [ ] **步骤 3：为 attach 等待写失败测试**

使用 fake timers 覆盖：

- URL 已存在时立即返回。
- URL 延迟出现时轮询后返回。
- 超时后抛出稳定错误。
- AbortSignal 取消时立即停止，不遗留 timer。

- [ ] **步骤 4：实现有界 `waitForSFTPAttachUrl()`**

默认等待上限使用常量并保持在合理秒级；测试注入短间隔和超时。连接池关闭或
窗口取消时传入 AbortSignal。得到 URL 后再调用 `SFTPConnection.connect()`。

- [ ] **步骤 5：运行针对性测试及前端类型检查**

```bash
npx vitest run tests/explorer/connection-strategy.test.ts tests/explorer/ref-counter.test.ts
cd frontend && pnpm exec tsc --noEmit
```

- [ ] **步骤 6：提交**

```bash
git add frontend/src/explorer/connection-pool.ts tests/explorer/connection-strategy.test.ts
git commit -m "feat(explorer): 连接池支持直接 SSH 连接"
```

---

## 任务 5：连接选择器支持两种来源

**文件：**

- 修改：`frontend/src/explorer/server-picker.ts`
- 新建：`tests/explorer/connection-picker.test.ts`
- 修改：`frontend/src/i18n/locales/zh-CN.ts`
- 修改：`frontend/src/i18n/locales/en-US.ts`

- [ ] **步骤 1：先写选择器状态失败测试**

把不依赖 DOM 的状态决定抽成纯函数，覆盖：

- 匿名用户默认 `direct` 且 `shouldFetchSavedServers === false`。
- 登录且有服务器默认 `saved`。
- 登录但无服务器默认 `direct`。
- `/api/servers` 401 后保留 `direct` 并标记 `sessionExpired`。
- 其他请求错误显示错误状态，但直接连接仍可用。

```bash
npx vitest run tests/explorer/connection-picker.test.ts
```

预期：状态函数不存在，测试失败。

- [ ] **步骤 2：实现选择器 UI**

扩展 `renderServerPicker()` 的 options：

- `authenticated`
- `authConfig`
- `connectedKeys`
- `onPickSaved(request)`
- `onSubmitDirect(request)`
- `onLogin?()`

匿名模式只挂载 `SSHConnectionForm`；登录模式显示“已保存服务器/直接连接”切换。
保存服务器只 fetch 一次。401 使用专门的 `AuthRequiredError` 或结构化结果，不再
统一抛出 `Failed to fetch servers`。

- [ ] **步骤 3：补充中英文文案**

至少包括：直接连接、已保存服务器、登录已过期、重新登录、连接并打开、登录后
可跨设备保存服务器、SFTP 初始化超时。同步保证中英文 key 集一致。

- [ ] **步骤 4：运行测试和构建**

```bash
npx vitest run tests/explorer/connection-picker.test.ts tests/explorer/server-data.test.ts tests/i18n.test.ts
cd frontend && pnpm run build
```

- [ ] **步骤 5：提交**

```bash
git add frontend/src/explorer/server-picker.ts frontend/src/i18n/locales/zh-CN.ts frontend/src/i18n/locales/en-US.ts tests/explorer/connection-picker.test.ts
git commit -m "feat(explorer): 连接选择器支持保存与直接连接"
```

---

## 任务 6：接入资源管理器匿名与登录流程

**文件：**

- 修改：`frontend/src/apps/explorer-app.ts`
- 修改：`frontend/src/main.ts`
- 修改：`frontend/src/explorer/tab-manager.ts`
- 修改：`frontend/src/explorer/desktop-explorer.ts`
- 修改：`frontend/src/explorer/mobile-explorer.ts`

- [ ] **步骤 1：更新 App 输入边界**

`main.ts` 向 `openExplorerWindow()` 传入明确的 `authenticated: boolean`。不要让
资源管理器通过故意请求 `/api/servers` 判断登录状态；401 只用于处理会话过期。

- [ ] **步骤 2：统一 request 数据流**

- 选择器返回 `ExplorerConnectionRequest`。
- `connectAndTab(request)` 调用 `tabs.createTab(request)`。
- `TabManager` 通过 request target 创建状态和标题。
- `allServers` 改为 `allTargets`；已保存 target 与池中的 direct target 同时用于
  桌面树和移动端切换。
- 新标签可以复用已连接的 direct target，不再次索取凭据。

- [ ] **步骤 3：处理取消和窗口关闭竞态**

资源管理器窗口持有 AbortController。关闭时先 abort 进行中的连接，再 dispose
UI、tabs 和 pool。所有 await 后挂载 UI/标签前检查取消状态。

- [ ] **步骤 4：针对性回归测试和构建**

```bash
npx vitest run tests/explorer
cd frontend && pnpm run build
```

- [ ] **步骤 5：人工烟雾验证**

- 匿名打开资源管理器时 Network 中无 `/api/servers`。
- 直接连接成功后加载 home 目录。
- 登录用户可分别选择保存服务器和直接连接。
- 新标签可复用同一 direct 连接。

- [ ] **步骤 6：提交**

```bash
git add frontend/src/main.ts frontend/src/apps/explorer-app.ts frontend/src/explorer/tab-manager.ts frontend/src/explorer/desktop-explorer.ts frontend/src/explorer/mobile-explorer.ts
git commit -m "feat(explorer): 接入匿名与登录统一连接流程"
```

---

## 任务 7：直接连接支持“在终端中打开”和标签拖出

**文件：**

- 修改：`frontend/src/apps/terminal-app.ts`
- 修改：`frontend/src/apps/explorer-app.ts`
- 修改：`frontend/src/explorer/explorer-actions.ts`
- 修改：`frontend/src/explorer/connection-pool.ts`
- 修改：`tests/explorer/actions-pure.test.ts`
- 新建：`tests/explorer/terminal-open-strategy.test.ts`

- [ ] **步骤 1：为来源分派写失败测试**

通过注入 fake terminal、fake token loader 和 fake window factory 测试纯分派边界：

- 保存来源每次请求新 token 后打开终端。
- 直接来源使用池内 request config 打开终端。
- 初始 nano/vim 命令只在新终端 session ready 后发送。
- 错误文本不包含密码或私钥。

```bash
npx vitest run tests/explorer/terminal-open-strategy.test.ts
```

预期：统一终端打开策略不存在，测试失败。

- [ ] **步骤 2：实现统一终端打开函数**

在 `terminal-app.ts` 增加接受 `ExplorerConnectionRequest` 的入口：

- saved：调用现有 `openTerminalFromWsUrl()`。
- direct：创建可见终端窗口、加载/沿用 expectedFingerprint、调用
  `terminal.connect(config)`，并在 ready 后执行 initialCommand。

不得把 config 放入 URL、窗口标题或全局事件 detail。

- [ ] **步骤 3：实现事务式标签拖出**

从原池读取 request，打开新资源管理器窗口并建立独立连接。只有新窗口报告首个
标签创建成功后才关闭原标签；失败时关闭新窗口并保留原标签。direct config
只通过内存函数参数传递。

- [ ] **步骤 4：验证**

```bash
npx vitest run tests/explorer/terminal-open-strategy.test.ts tests/explorer/actions-pure.test.ts tests/explorer/tab-logic.test.ts
cd frontend && pnpm run build
```

人工验证保存和直接连接分别执行 nano/vim 打开、标签拖出成功和拖出失败回滚。

- [ ] **步骤 5：提交**

```bash
git add frontend/src/apps/terminal-app.ts frontend/src/apps/explorer-app.ts frontend/src/explorer/explorer-actions.ts frontend/src/explorer/connection-pool.ts tests/explorer/actions-pure.test.ts tests/explorer/terminal-open-strategy.test.ts
git commit -m "feat(explorer): 直接连接支持终端打开与标签拖出"
```

---

## 任务 8：错误清理、安全回归与双模式验收

**文件：**

- 修改：`frontend/src/explorer/connection-pool.ts`
- 修改：`frontend/src/apps/ssh-connection-form.ts`
- 修改：`tests/explorer/connection-strategy.test.ts`

- [ ] **步骤 1：补齐失败清理测试**

覆盖：

- SSH 失败释放 terminal 和隐藏 mount。
- SFTP 不支持/初始化失败释放两条 WebSocket。
- attach 超时和 abort 不遗留 timer。
- 同一个 key 的并发 connect 共享进行中 Promise。
- 失败后可再次连接，不残留 connecting 项。
- `disposeAll()` 清理 direct request/config 引用。

- [ ] **步骤 2：安全扫描**

```bash
rg -n "password|privateKey" frontend/src/explorer frontend/src/apps/explorer-app.ts frontend/src/apps/terminal-app.ts
```

逐项确认命中只用于内存 config/认证调用，不进入日志、通知、HTML 字符串、data
属性或 URL。

- [ ] **步骤 3：移动与桌面 UI 验证**

- 桌面保存/直接切换、服务器树、多标签、断开。
- 移动端直接连接、切换服务器、返回键和关闭。
- 401 登录过期时直接连接仍可用。
- 连接失败后清空未持久化的密码/私钥，保留 host/port/username。
- 中英文切换后新文案即时更新。

若人工验收发现功能缺口，返回对应的任务和测试先修复，不在本任务捆绑无测试的
临时 UI 改动。

- [ ] **步骤 4：运行范围测试**

```bash
npx vitest run tests/explorer tests/credential-store.test.ts tests/i18n.test.ts tests/terminal-overlay.test.ts tests/terminal-status.test.ts
cd frontend && pnpm run build
```

- [ ] **步骤 5：提交**

```bash
git add frontend/src/explorer/connection-pool.ts frontend/src/apps/ssh-connection-form.ts tests/explorer/connection-strategy.test.ts
git commit -m "fix(explorer): 完善直接连接错误清理与界面状态"
```

---

## 任务 9：全量验证与生成前端内联产物

**文件：**

- 自动生成：`src/worker/html.ts`

本计划不改变 AGENTS.md 所列维护触发文件的接口、构建命令或部署结构，因此不
修改 `AGENTS.md`。

- [ ] **步骤 1：全量测试**

```bash
pnpm test
```

预期：所有测试通过，无失败和未处理异常。

- [ ] **步骤 2：根与前端类型检查**

```bash
npx tsc --noEmit
cd frontend && pnpm exec tsc --noEmit
```

- [ ] **步骤 3：生成生产前端**

从仓库根目录运行：

```bash
pnpm run build:frontend
```

确认命令成功，并确认 `src/worker/html.ts` 中存在新的资源管理器直接连接文案。
禁止手工编辑该文件。

- [ ] **步骤 4：构建安全回归**

```bash
npx vitest run tests/build tests/worker/security.test.ts tests/worker/dns-check.test.ts
```

- [ ] **步骤 5：检查工作区范围**

```bash
git status --short
git diff --check
git diff --stat
```

只允许计划内源文件、测试和自动生成的 `src/worker/html.ts`。

- [ ] **步骤 6：提交自动生成产物**

```bash
git add src/worker/html.ts
git commit -m "chore: 更新资源管理器前端构建产物"
```

- [ ] **步骤 7：最终人工验收**

使用匿名和登录账号各验证一次：

1. 匿名直接密码连接与私钥连接。
2. 登录保存服务器连接与直接连接。
3. 目录浏览、上传、下载、新建、重命名、删除和 chmod。
4. 多标签、切换、断开、标签拖出。
5. nano/vim“在终端中打开”。
6. Turnstile 启用环境下首次验证及同会话复用。
7. 主机指纹首次保存、匹配和变化阻断。
8. 关闭窗口后浏览器中无遗留主/SFTP WebSocket。

---

## 完成标准

- 匿名用户打开资源管理器不请求 `/api/servers`，可以直接连接并使用完整 SFTP。
- 登录用户同时拥有保存服务器和直接连接入口。
- 保存与直接路径在连接后共享相同的资源管理器行为。
- `/api/servers` 认证、Turnstile、限流、DNS 检查、TOFU 和凭据持久化边界未被
  削弱。
- 自动化测试、两套 TypeScript 检查、生产前端构建和人工双模式验收全部通过。
- 工作区只包含已提交的计划内变更，`src/worker/html.ts` 来自构建脚本。
