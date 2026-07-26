# 资源管理器统一连接入口设计

- 日期：2026-07-26
- 状态：设计已确认，待实施计划
- 范围：SP2 资源管理器补充功能

## 1. 背景

SP2 资源管理器目前只能读取 `/api/servers` 返回的已保存服务器，再通过
`/api/servers/:id/connect` 获取一次性 token 建立 SSH 主连接。由于
`/api/servers` 必须登录，匿名用户打开资源管理器时只能看到空白选择页和
`Failed to fetch servers` 错误。

CloudSSH 现有匿名快速连接及上游 SFTP 实现已经证明，匿名用户可以通过直接
SSH 连接获得 `sftp_attach` URL，再连接 `/api/ssh/sftp` 使用文件管理功能。
因此问题不在 Worker 或 SFTP 协议能力，而在 SP2 前端把资源管理器连接来源
限定成了带数据库数字 ID 的 `SavedServer`。

## 2. 目标

1. 匿名用户可以在资源管理器中直接输入主机、端口、SSH 用户名和密码/私钥，
   连接后使用完整的 SFTP 文件管理能力。
2. 登录用户既可以选择 `/api/servers` 中的已保存服务器，也可以直接连接临时
   服务器。
3. 两种连接来源进入相同的资源管理器、标签页、连接池和文件操作流程。
4. `/api/servers`、云端 known-hosts 和其他账户数据继续要求登录。
5. 直接连接继续使用现有 Turnstile、SSH 速率限制、DNS 安全检查和 TOFU
   主机指纹机制。
6. 复用现有快速连接表单逻辑，不维护两套字段校验、凭据记忆和 Turnstile
   行为。

## 3. 非目标

- 不开放匿名 `/api/servers` CRUD。
- 不把匿名凭据写入 Worker、Durable Object 或用户数据库。
- 不修改 SSH、SFTP 协议实现。
- 不在本次工作中增加“直接连接后自动保存到服务器列表”。登录用户仍可在
  服务器 App 中单独保存服务器；该能力以后可独立设计。
- 不改变 AI Agent 的登录和配置约束。

## 4. 方案比较

### 4.1 临时负数 ID

为直接连接生成负数 `serverId`，尽量保留现有 `Map<number, ...>` 和状态结构。

优点是初始改动少。缺点是保存服务器 ID、临时连接 ID 和业务语义混在一起，
容易在 `/api/servers/:id/connect`、跨服务器剪贴板和重新连接中误走保存服务器
路径，也难以支持同一主机的多个独立临时会话。

### 4.2 统一连接目标（采用）

将资源管理器显示信息、连接标识和建立连接所需的秘密信息分离。连接池接受
`saved` 和 `direct` 两种连接说明，建立 SSH 后统一创建 `SFTPConnection`。

改动面比负数 ID 大，但边界清晰，不需要修改后端，也能完整复用资源管理器。

### 4.3 新增匿名连接 token API

新增 HTTP API 接收直接连接凭据并返回一次性 token，使两条路径都使用
`connectWithWebSocket()`。

该方案会扩大后端凭据处理和攻击面，还会重复现有 `/api/ssh` 直接连接能力，
并不能消除前端“保存服务器 ID 等于连接身份”的耦合，因此不采用。

## 5. 统一数据模型

资源管理器不再以 `SavedServer` 作为唯一领域对象。

```ts
type ExplorerConnectionKey =
  | `saved:${number}`
  | `direct:${string}`;

interface ExplorerTarget {
  key: ExplorerConnectionKey;
  source: 'saved' | 'direct';
  name: string;
  host: string;
  port: number;
  username: string;
}

type ExplorerConnectSpec =
  | {
      source: 'saved';
      serverId: number;
    }
  | {
      source: 'direct';
      config: SSHConnectionConfig;
    };

interface ExplorerConnectionRequest {
  target: ExplorerTarget;
  connect: ExplorerConnectSpec;
}
```

设计约束：

- `ExplorerTarget` 只含可显示的非秘密信息，可安全进入标签、目录树和状态对象。
- 密码和私钥只存在于 `ExplorerConnectSpec`、连接池及 `SSHTerminal` 的活动
  会话内存中，不写入 `ExplorerState`、DOM data 属性、日志或错误消息。
- `saved:<id>` 对同一已保存服务器保持稳定，用于连接复用和引用计数。
- 每次直接提交生成新的 `direct:<uuid>`。同一直接连接创建的新标签继续共享该
  key；再次提交相同主机则建立独立会话，避免凭据变化或会话意图被错误合并。
- `Tab.serverId`、`ExplorerState.serverId`、剪贴板 `sourceServerId` 和连接池 Map
  统一改为语义明确的 `connectionKey` 字符串。

## 6. 连接选择界面

现有 `server-picker.ts` 升级为连接选择器，负责组合两种来源，但不负责建立
SSH 连接。

### 6.1 匿名用户

- 打开资源管理器后直接显示“直接连接”表单。
- 表单包含主机、端口、用户名、密码/私钥、区域、Turnstile、“记住连接”和
  本地最近连接。
- 不请求 `/api/servers`，因此不会产生预期内的 401 和错误通知。
- 可以显示非阻断的登录入口，说明登录后可跨设备保存服务器，但不能把登录
  描述成使用资源管理器的前置条件。

### 6.2 登录用户

- 连接选择器提供“已保存服务器”和“直接连接”两个入口。
- 有已保存服务器时默认展示服务器卡片；没有已保存服务器时默认展示直接连接。
- `/api/servers` 返回 401 时视为登录过期：隐藏保存服务器列表、保留直接连接，
  并提示重新登录。
- 直接连接的“记住连接”仍保存到浏览器最近连接，不自动写入账户服务器列表。

### 6.3 表单复用

将现有 `QuickConnectForm` 中的表单、校验、Turnstile、密钥文件读取、最近连接
和凭据加解密能力提取为可复用的 `SSHConnectionForm`。表单提交只返回经过
校验的 `SSHConnectionConfig` 及显示元数据，不自行创建终端窗口。

- 服务器 App 注入回调：创建可见终端窗口并调用 `terminal.connect()`。
- 资源管理器注入回调：创建 `ExplorerConnectionRequest` 并交给连接池。

原 `QuickConnectForm` 可以保留为服务器 App 的薄包装，避免一次性改动其窗口
生命周期接口。

## 7. 统一连接池

`ConnectionPool.connect(request)` 根据 `connect.source` 选择 SSH 建立方式。

### 7.1 已保存服务器路径

1. 调用 `connectServerWs(serverId)` 获取一次性 WebSocket URL。
2. 创建隐藏 `SSHTerminal`。
3. 调用 `terminal.connectWithWebSocket()`。
4. 等待 SSH session ready 和 `sftp_attach` URL。

### 7.2 直接连接路径

1. 通过 `loadKnownFingerprint(host, port)` 加载主机指纹：登录用户优先云端，
   匿名用户回退 localStorage。
2. 将指纹写入 `SSHConnectionConfig.expectedFingerprint`。
3. 创建隐藏 `SSHTerminal` 并调用 `terminal.connect(config)`。
4. 该调用复用现有 `/api/ssh`、Turnstile cookie/token、区域提示和凭据发送流程。
5. 等待 SSH session ready 和 `sftp_attach` URL。

### 7.3 公共 SFTP 阶段

两条路径都使用 `terminal.getSFTPWebSocketUrl()` 创建 `SFTPConnection`，发送
`sftp_init` 并等待 `sftp_ready`。连接成功后才写入连接池并创建标签页。

连接池应使用一个有界等待函数等待 `sftp_attach` URL，避免主连接 ready 与
attach 消息存在短暂竞态时立即报“SFTP 地址不可用”。超时或 SFTP 初始化失败
时必须销毁刚创建的 SSH 主连接和隐藏 DOM。

## 8. 标签、目录树与跨服务器操作

- `TabManager`、`ExplorerState`、`ExplorerActions`、桌面目录树和移动端切换器
  全部使用 `ExplorerConnectionKey`，不关心连接来自数据库还是直接输入。
- 连接池中的 `PooledConnection` 保留对应的 `ExplorerConnectionRequest`，供同一
  窗口内的新标签、“在终端中打开”和拖出窗口使用；状态对象和 UI 不直接持有
  其中的秘密字段。
- 同一连接的多个标签继续通过引用计数共享一个 SSH/SFTP 会话。
- 关闭资源管理器窗口时，保存和直接连接都执行相同的 `disposeAll()`。
- 跨服务器复制、移动和剪贴板来源比较使用 `connectionKey`，保持现有行为。
- 目录树显示 `ExplorerTarget.name`；直接连接默认名称为
  `username@host[:port]`。
- 标签拖出时，新窗口使用原连接池中的 request 建立独立连接；新窗口连接成功
  后再关闭原标签。若新连接失败，原标签和原连接保持不变。request 不进入 URL、
  DOM 或持久化存储。

## 9. “在终端中打开”行为

资源管理器当前通过保存服务器 ID 获取新 token，再打开终端执行命令。直接
连接没有服务器 ID，因此该行为也必须按连接来源统一：

- 已保存服务器：继续获取新的 `/api/servers/:id/connect` token。
- 直接连接：在活动资源管理器窗口内存中读取该连接的 `SSHConnectionConfig`，
  创建新的可见终端并调用 `terminal.connect(config)`，连接成功后执行初始命令。

直接连接凭据只在对应资源管理器窗口及其派生终端建立期间存活。窗口销毁后不再
能从资源管理器重新打开该连接；用户勾选“记住连接”时，后续重连仍通过现有
加密最近连接存储重新填充表单。

## 10. 安全与防滥用

1. `/api/servers` 和 `/api/servers/:id/connect` 保持登录认证，不新增匿名数据
   访问能力。
2. 直接连接继续走 `/api/ssh`，保留 Worker 隔离实例内的限流、Turnstile、
   Origin 校验、DNS 安全检查和禁止 `x-ssh-config` 注入。
3. 登录身份不自动绕过直接连接的防滥用控制；同一浏览器会话已有有效
   Turnstile cookie 时可复用现有验证结果。
4. 密码和私钥不得进入连接 key、标签标题、通知、日志、测试快照或 URL。
5. 未勾选“记住连接”时不写入持久化存储；勾选后沿用现有浏览器端加密凭据
   存储。
6. 匿名 TOFU 指纹保存在 localStorage；登录用户继续优先使用云端 known-hosts
   并回退 localStorage。
7. 主连接、SFTP attach 连接、定时器和隐藏终端 DOM 必须随失败、断开或窗口
   关闭一起清理。

## 11. 错误处理

| 场景 | 行为 |
|------|------|
| 已保存服务器列表 401 | 保留直接连接入口，提示登录已过期 |
| Turnstile 未完成或失败 | 停留在连接表单并显示验证提示 |
| SSH 认证失败 | 销毁临时连接，保留主机/端口/用户名，清空未持久化的密码和私钥 |
| 主机指纹变化 | 沿用终端的阻断和 known-host 清理流程 |
| 服务器不支持 SFTP | 关闭隐藏 SSH 会话，返回连接选择器并显示明确错误 |
| 等待 `sftp_attach` 超时 | 关闭主连接，提示 SFTP 初始化超时 |
| 窗口在连接中关闭 | 标记请求已取消并清理迟到的 WebSocket/DOM，不再挂载标签 |
| 连接中断 | 沿用资源管理器断线状态和断开处理，不泄漏凭据 |

## 12. 测试策略

### 12.1 纯逻辑测试

- 保存服务器映射为 `saved:<id>`。
- 直接连接生成唯一 `direct:<uuid>`。
- 连接 key 的引用计数、标签关闭和剪贴板来源比较。
- 连接选择器在匿名、登录、有服务器、无服务器和登录过期状态下选择正确入口。

### 12.2 组件测试

- `SSHConnectionForm` 对密码/私钥、端口、主机、Turnstile 和密钥文件的校验。
- 服务器 App 提交表单后仍创建可见终端。
- 资源管理器提交表单后创建 direct request，且 DOM/错误中不包含凭据。
- 已保存连接调用 `connectServerWs()`，直接连接调用 `terminal.connect()`。
- 两条路径最终都等待并创建同一个 `SFTPConnection`。
- 连接失败、attach 超时和窗口关闭都会清理隐藏终端。

### 12.3 回归与人工验证

- 匿名用户从资源管理器直接连接，完成目录浏览、上传、下载、新建、重命名和
  删除。
- 登录用户分别通过已保存服务器和直接连接进入资源管理器。
- 同一连接创建多个标签、切换服务器、断开和关闭窗口。
- 保存服务器和直接连接的标签分别拖出为新资源管理器窗口，并验证失败时原标签
  不丢失。
- 直接连接使用“在终端中打开”。
- 启用和禁用 Turnstile 两种环境。
- 密码与 Ed25519 私钥两种认证方式。
- 桌面和移动模式。
- 运行 `pnpm test`、根 TypeScript 检查、前端构建，并确认生成的
  `src/worker/html.ts` 包含最新资源管理器代码。

## 13. 兼容性与部署

- 不新增或修改 Worker API、Durable Object、环境变量和 `wrangler.toml`。
- 已保存服务器连接路径保持兼容。
- 主要变更位于前端连接模型、连接选择器、连接池、标签/状态类型和快速连接
  表单复用。
- 实施完成后必须运行 `pnpm run build:frontend`；`src/worker/html.ts` 仍由构建
  脚本生成，禁止手工编辑。

## 14. 验收标准

1. 匿名用户打开资源管理器不会请求 `/api/servers`，也不会看到登录阻断页或
   `Failed to fetch servers`。
2. 匿名用户可以用密码或私钥直接连接并使用完整资源管理器功能。
3. 登录用户可以在已保存服务器和直接连接之间选择，连接后的功能一致。
4. 两种来源支持标签、连接复用、断开、跨服务器操作及“在终端中打开”。
5. 匿名凭据不进入服务端持久化，现有认证、Turnstile、限流和主机指纹保护
   不被削弱。
6. 连接失败、取消和窗口关闭不会遗留 WebSocket、定时器或隐藏终端 DOM。
7. 现有服务器 App 匿名快速连接和登录用户保存服务器连接无回归。
