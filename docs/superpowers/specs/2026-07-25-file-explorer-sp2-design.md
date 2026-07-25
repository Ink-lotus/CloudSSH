# SP2 设计规格：资源管理器（File Explorer）

> 日期：2026-07-25
> 状态：设计定稿
> 前置：SP1 桌面外壳（已完成）、移动端外壳（已完成）

---

## 1. 概述

SP2 将现有的 SFTP 滑出面板替换为**独立的资源管理器 App**，提供类 Windows 资源管理器的文件浏览和管理体验。资源管理器与终端窗口完全解耦，自行管理服务器连接，支持跨服务器文件传输。

### 目标

- 独立 App，桌面图标 + 开始菜单 + 移动端主屏均有入口
- 多标签页系统：一个窗口内多标签页，可拖出为独立窗口
- 多连接：左侧树可同时保持多个服务器连接
- 桌面端：可收起目录树 + 标签栏 + 详细列表 + 面包屑 + 工具栏 + 右键菜单 + 键盘快捷键
- 移动端：单面板 + 路径栏 + 竖三点文件菜单 + 全局菜单
- 全功能操作：复制/移动/粘贴、多选批量操作、chmod、搜索/过滤
- 打开方式菜单：所有文件通过 nano/vim/下载 三选一打开
- 跨服务器三级传输策略
- 完全移除旧 SFTP 面板

### 非目标

- 文件缩略图/图片预览（SP3）
- 图标网格视图（SP3）
- 移动端双面板模式（暂不做）

---

## 2. 架构

### 2.1 文件结构

```
frontend/src/
  apps/
    explorer-app.ts              — App 入口：注册 ShellApp，打开窗口，协调连接流程
  explorer/
    sftp-connection.ts           — 独立 SFTP WebSocket 连接管理（从旧 SFTPPanel 提取）
    connection-pool.ts           — 多连接池管理（按服务器维护多个 SFTPConnection）
    explorer-state.ts            — 核心状态（路径、文件列表、选中、剪贴板、导航历史）
    explorer-actions.ts          — 业务操作（导航、CRUD、复制/移动、chmod、搜索）
    tab-manager.ts               — 标签页管理（创建/关闭/切换/拖出为独立窗口）
    desktop-explorer.ts          — 桌面布局：可收起目录树 | 标签页 | 详细列表 + 面包屑 + 工具栏
    mobile-explorer.ts           — 移动布局：单面板
    context-menu.ts              — 右键菜单（桌面）/ 竖三点菜单（移动），含"打开方式"二级菜单
    server-picker.ts             — 服务器选择页（复用已保存服务器数据）
  shared/
    server-data.ts               — 共享的服务器数据获取函数
```

### 2.2 生命周期

```
用户点击桌面图标/开始菜单/移动端图标
  → explorer-app.ts 调用 wm.openWindow() 打开窗口
  → server-picker.ts 展示已保存的服务器列表
  → 用户选择服务器
  → connection-pool 建立/复用 SFTPConnection
  → tab-manager 创建第一个标签页，绑定该连接
  → 根据 ctx.getMode() 挂载 DesktopExplorer 或 MobileExplorer
  → 每个标签页持有独立的 ExplorerState + ExplorerActions
```

### 2.3 与现有架构的关系

- `explorer-app.ts` 与 `terminal-app.ts`、`servers-app.ts`、`settings-app.ts` 平级
- 通过 `ShellController.registerApps()` 注册
- 通过 `ShellContext` 获取当前模式并响应模式切换
- 旧的 `sftp-panel.ts` 在 SP2 完成后删除

---

## 3. 连接管理 — SFTPConnection

从现有 `SFTPPanel` 中提取 WebSocket 连接逻辑为独立类。

```typescript
interface SFTPConnectionOptions {
  wsUrl: string;
  onReady: () => void;
  onDisconnect: () => void;
  onError: (err: string) => void;
}

class SFTPConnection {
  // 生命周期
  connect(opts: SFTPConnectionOptions): void;
  dispose(): void;
  isConnected(): boolean;

  // 文件操作（全部 Promise 化）
  listDirectory(path: string): Promise<SFTPFileEntry[]>;
  stat(path: string): Promise<SFTPFileEntry>;
  downloadFile(path: string, onProgress: ProgressCb): Promise<Blob>;
  uploadFile(path: string, data: Blob, onProgress: ProgressCb): Promise<void>;
  deleteFile(path: string): Promise<void>;
  deleteDirectory(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;

  // SSH exec 通道（用于 cp、wget、find）
  exec(command: string): Promise<string>;
}
```

设计要点：

- 全部操作 Promise 化，替代旧面板的事件回调风格
- `exec()` 暴露 SSH exec 通道，供同服务器 `cp` 和跨服务器 `wget` 使用
- 心跳保留（30s interval），断线自动通知上层

### 3.2 连接池 — ConnectionPool

管理多个服务器连接的生命周期，支持左侧树同时展开多台服务器。

```typescript
// explorer/connection-pool.ts

class ConnectionPool {
  // 按服务器 ID 维护连接
  connect(server: SavedServer): Promise<SFTPConnection>;
  disconnect(serverId: string): void;
  get(serverId: string): SFTPConnection | null;
  getAll(): Map<string, SFTPConnection>;
  disposeAll(): void;

  // 事件
  onConnectionChange(cb: (serverId: string, status: 'connected' | 'disconnected') => void): void;
}
```

设计要点：

- 每个连接的服务器维护一个 `SFTPConnection` 实例
- 多个标签页可共享同一服务器的连接（引用计数）
- 关闭最后一个使用该连接的标签页时，提示用户是否断开
- 资源管理器窗口关闭时，`disposeAll()` 清理全部连接

---

## 4. 核心状态 — ExplorerState

每个标签页持有一个独立的 `ExplorerState` 实例。

```typescript
interface ExplorerState {
  // 所属标签页
  tabId: string;
  serverId: string;            // 当前连接的服务器
  connection: SFTPConnection;  // 引用连接池中的实例

  // 导航
  currentPath: string;
  files: SFTPFileEntry[];
  history: string[];          // 后退栈
  forwardStack: string[];     // 前进栈

  // 选中
  selectedFiles: Set<string>; // 按文件名
  lastClickedFile: string | null; // Shift 多选锚点

  // 剪贴板
  clipboard: {
    files: SFTPFileEntry[];
    sourcePath: string;
    sourceConnection: SFTPConnection;  // 记住来源连接（跨服务器用）
    mode: 'copy' | 'move';
  } | null;

  // UI 状态
  loading: boolean;
  error: string | null;
  sortBy: 'name' | 'size' | 'modified' | 'permissions';
  sortAsc: boolean;
  treeCollapsed: boolean;     // 桌面端目录树是否收起
  searchQuery: string | null; // 当前搜索/过滤关键词
}
```

状态变更通过回调通知 UI 层（desktop/mobile），UI 层只负责渲染和捕获用户事件。

---

## 5. 业务操作 — ExplorerActions

```typescript
class ExplorerActions {
  constructor(state: ExplorerState, pool: ConnectionPool);

  // 导航
  navigate(path: string): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  goHome(): Promise<void>;
  refresh(): Promise<void>;

  // 选中
  select(name: string, mode: 'single' | 'toggle' | 'range'): void;
  selectAll(): void;
  clearSelection(): void;

  // 剪贴板
  copy(): void;           // 选中项 → 剪贴板（mode=copy）
  cut(): void;            // 选中项 → 剪贴板（mode=move）
  paste(): Promise<void>; // 执行粘贴（检测同/跨服务器，走三级策略）

  // CRUD
  upload(files: FileList): Promise<void>;
  download(): Promise<void>;
  delete(): Promise<void>;
  rename(oldName: string, newName: string): Promise<void>;
  mkdir(name: string): Promise<void>;
  chmod(name: string, mode: number): Promise<void>;

  // 搜索
  filter(query: string): void;           // 客户端过滤当前列表
  search(query: string): Promise<void>;  // SSH exec find 远程搜索

  // 打开方式
  openWith(path: string, method: 'nano' | 'vim' | 'download'): Promise<void>;

  // 排序
  sort(by: SortKey, asc: boolean): void;
}
```

---

## 6. 标签页管理 — TabManager

一个资源管理器窗口内支持多个标签页，每个标签页有独立的服务器连接、路径状态。标签页可以拖出成为独立的资源管理器窗口。

```typescript
// explorer/tab-manager.ts

interface Tab {
  id: string;
  serverId: string;
  title: string;              // 显示为 "服务器名:当前目录名"
  state: ExplorerState;
  actions: ExplorerActions;
}

class TabManager {
  // 标签页 CRUD
  createTab(server: SavedServer): Promise<Tab>;   // 新建标签页并连接服务器
  closeTab(tabId: string): void;
  switchTab(tabId: string): void;
  getActiveTab(): Tab;
  getAllTabs(): Tab[];

  // 拖出为独立窗口
  detachTab(tabId: string): void;  // 拖出标签页 → 调用 wm.openWindow() 创建新窗口

  // 事件
  onTabChange(cb: () => void): void;
}
```

### 桌面端标签栏布局

```
┌──────────────────────────────────────────────────────┐
│ [开发机:/home] [生产机:/var/log] [+]                   │  标签栏（可拖拽排序/拖出）
├──────────────────────────────────────────────────────┤
│ ← → ↑ 🏠 │ /home/user/documents           │ 🔍 搜索  │  当前标签的工具栏
├──────────┬───────────────────────────────────────────┤
│ 目录树    │ 文件列表                                  │
...
```

### 交互

- 点击标签切换；中键点击关闭标签
- `[+]` 按钮新建标签页（弹出服务器选择）
- 拖拽标签页到标签栏外 → 拖出为独立资源管理器窗口
- 从其他资源管理器窗口拖入标签 → 合并
- 只剩一个标签时，标签栏仍显示（不隐藏），方便新建
- 移动端不显示标签栏，一个窗口只有一个标签页（通过 `[≡]` 菜单的"新窗口"功能代替）

---

## 7. 跨服务器传输 — 三级策略

### 策略表

| 优先级 | 条件 | 方案 | 数据路径 |
|--------|------|------|----------|
| 1 | 同服务器 | SFTP rename / SSH exec `cp` | 服务器内部 |
| 2 | 跨服务器 ≤64MB | Worker DO 间中转 | 服务器A → DO_A → DO_B → 服务器B |
| 3 | 跨服务器 >64MB | R2 + wget | 服务器A → DO → R2 → 服务器B wget |
| 4 | 以上均失败 | 浏览器中转 | 服务器A → 浏览器 → 服务器B |

### paste() 伪代码

```
paste() {
  if (clipboard.sourceConnection === this.connection) {
    // 同服务器
    if (mode === 'move') → SFTP rename
    if (mode === 'copy') → SSH exec cp -r
  } else if (totalSize <= 64MB) {
    // 跨服务器小文件 → Worker DO 间中转
    → 前端发请求给目标 DO，目标 DO 通过 stub.fetch() 向源 DO 拉取文件流式写入
  } else if (await targetHasWget()) {
    // 跨服务器大文件 → R2 + wget
    → 源 DO 读取文件写入 R2
    → 生成签名临时 URL（10 分钟有效）
    → 目标 DO 执行 SSH exec wget <URL> -O <目标路径>
    → 清理 R2 临时文件
  } else {
    // 兜底 → 浏览器中转
    → 从源服务器下载到浏览器内存/Blob
    → 上传到目标服务器
  }
}
```

---

## 8. 桌面端 UI — DesktopExplorer

### 8.1 布局

```
┌──────────────────────────────────────────────────────┐
│ [开发机:/home] [生产机:/var/log] [+]                   │  标签栏
├──────────────────────────────────────────────────────┤
│ ← → ↑ 🏠 │ /home/user/documents           │ 🔍 搜索  │  工具栏 + 面包屑 + 搜索
├──────────┬───────────────────────────────────────────┤
│ ▼ 生产 ●  │ 名称          大小    权限     修改时间   │  列头（可点击排序）
│  ▶ /etc  │─────────────────────────────────────────│
│  ▶ /var  │ 📁 downloads    4K   drwxr-x  07-24 10:30│
│ ▼ 开发 ●  │ 📁 .ssh         4K   drwx---  07-20 09:15│
│  ▼ /home │ 📄 readme.txt  1.2K  -rw-r--  07-23 14:22│
│   ▼ user │ 📄 config.yml  340B  -rw-r--  07-22 11:05│
│    docs  │                                          │
│ ▶ 测试机  │                                          │
├──────────┴──────────────────────────────────────────┤
│ 4 个项目 │ 已选中 1 项 (1.2 KB)          已连接 ●    │  状态栏
└─────────────────────────────────────────────────────┘
```

### 8.2 左侧树面板

- 默认折叠显示所有已保存的服务器
- 已连接的服务器显示 ● 标记并可展开目录树（**支持同时连接多台服务器**）
- 点击未连接的服务器 → 建立新连接 → 展开目录树（不断开已有连接）
- 点击已连接服务器的目录节点 → 当前标签页导航到该目录
- 多个连接的服务器均可展开，便于跨服务器拖拽/复制
- 可收起整个树面板（只留面包屑导航）

### 8.3 交互

| 操作 | 行为 |
|------|------|
| 单击文件 | 选中（清除其他选中） |
| Ctrl+单击 | 切换选中（多选） |
| Shift+单击 | 范围选中 |
| 双击文件夹 | 导航进入 |
| 双击文件（非文件夹） | 弹出"打开方式"菜单（nano / vim / 下载） |
| 右键 | 弹出上下文菜单 |
| 拖拽本地文件到列表区 | 上传 |
| Ctrl+C / Ctrl+X / Ctrl+V | 复制 / 剪切 / 粘贴 |
| Delete 键 | 删除选中项（确认对话框） |
| F2 | 重命名选中项 |
| 面包屑点击 | 导航到对应层级 |
| 目录树节点点击 | 导航到该目录 |
| 列头点击 | 按该列排序，再次点击反转 |

### 8.4 右键菜单

选中文件时：

```
打开方式 →  nano
             vim
             下载
复制
移动
删除
重命名
属性(chmod)
```

选中文件夹时：`打开 / 复制 / 移动 / 删除 / 重命名 / 属性(chmod)`

空白区域：`上传文件 / 新建文件夹 / 粘贴 / 刷新`

---

## 9. 移动端 UI — MobileExplorer

### 9.1 布局

```
┌─────────────────────────┐
│ 🗂 /home/user      [≡]  │  路径栏 + 菜单按钮
├─────────────────────────┤
│ 📁 documents     →   ⋮  │
│ 📁 downloads     →   ⋮  │  每行右侧竖三点
│ 📄 readme.txt  1.2K  ⋮  │
│ 📄 config.yml  340B  ⋮  │
│                         │
│                         │
│  ◀任务  ●主页  ▶返回    │  MobileShell 三键栏
└─────────────────────────┘
```

### 9.2 全局菜单 [≡]

`上传文件 / 新建文件夹 / 搜索 / 粘贴（剪贴板有内容时显示）/ 排序方式 / 刷新 / 新窗口 / 切换服务器 / 断开连接`

注：移动端不显示标签栏，通过"新窗口"打开新的资源管理器窗口代替。

### 9.3 竖三点文件菜单 ⋮

```
打开方式 →  nano
             vim
             下载
复制
移动
删除
重命名
属性
```

文件夹的竖三点菜单不含"打开方式"，直接点击文件夹即导航进入。

### 9.4 交互

- 点击文件夹：导航进入
- 点击文件（非文件夹）：弹出"打开方式"菜单（nano / vim / 下载）
- 长按文件：进入多选模式，底部浮出批量操作栏
- 复制/移动操作后，`[≡]` 菜单出现"粘贴"选项，导航到目标目录后点"粘贴"执行
- 返回键行为：返回上一级目录，已在根目录则关闭资源管理器

### 9.5 与 MobileShell 集成

- 资源管理器窗口在 MobileShell 中全屏显示
- `onBack` 回调：先回退目录，目录栈为空则关闭窗口

---

## 10. 打开方式

不自建编辑器。所有非文件夹文件通过"打开方式"二级菜单选择操作，不自动打开或下载。

### 打开方式菜单

| 选项 | 行为 |
|------|------|
| nano | 调用 `createTerminalWindow(wsUrl, initialCommand: "nano <path>")` 打开终端编辑 |
| vim | 调用 `createTerminalWindow(wsUrl, initialCommand: "vim <path>")` 打开终端编辑 |
| 下载 | 通过 `SFTPConnection.downloadFile()` 下载到本地 |

### 触发方式

- **桌面端：** 双击文件弹出打开方式菜单；右键菜单中"打开方式 →"二级子菜单
- **移动端：** 点击文件弹出打开方式菜单；竖三点菜单中"打开方式 →"二级子菜单

### 终端 App 增强

`createTerminalWindow()` 新增 `initialCommand` 参数，供资源管理器调用。

---

## 11. 搜索/过滤

| 模式 | 触发 | 实现 |
|------|------|------|
| 即时过滤 | 搜索框输入 | 客户端 `name.includes(query)` 过滤 |
| 远程搜索 | 按回车/点搜索按钮 | SSH exec `find . -name "*query*" -maxdepth 5` |

远程搜索结果以平面列表展示（显示完整路径），双击/点击导航到文件所在目录。

---

## 12. 属性面板（chmod）

桌面端右键 → 属性，移动端竖三点 → 属性，弹出模态框：

```
┌─ 文件属性 ──────────────┐
│ 名称: config.yml         │
│ 大小: 340 B              │
│ 修改: 2026-07-24 10:30   │
│ 权限: -rw-r--r-- (644)   │
│                          │
│ 所有者  ☑读 ☑写 ☐执行    │
│ 组     ☑读 ☐写 ☐执行    │
│ 其他   ☑读 ☐写 ☐执行    │
│                          │
│       [应用] [取消]       │
└──────────────────────────┘
```

通过 `SFTPConnection.chmod()` 调用后端 SFTP `setstat` 应用权限变更。

---

## 13. 后端变更

### 13.1 SFTPHandler 扩展

| 新增操作 | 说明 |
|---------|------|
| `chmod` | 调用 SFTP `setstat` 设置文件权限 |
| `readTextFile` | 小文件全量读取返回文本内容 |
| `exec` | SSH exec 通道执行命令（`cp`、`wget`、`find`） |

### 13.2 跨服务器传输 — Worker 端

**小文件 ≤64MB — DO 间中转：**

```
前端发起请求: { action: "crossTransfer", sourceDoId, sourcePath, targetPath }
  → 目标 DO 通过 stub.fetch() 请求源 DO
  → 源 DO 读取文件流式返回
  → 目标 DO 写入到目标路径
```

**大文件 >64MB — R2 + wget：**

```
1. 前端 → 源 DO: "上传到 R2"
   源 DO 读取文件 → 写入 R2（分块流式）→ 返回签名临时 URL（10 分钟有效）
2. 前端 → 目标 DO: "exec wget <签名URL> -O <目标路径>"
   目标 DO 执行 SSH exec → wget 下载完成
3. 前端 → Worker: "清理 R2 临时文件"
```

需要 `wrangler.toml` 新增 R2 bucket 绑定。

---

## 14. 集成与迁移

### 14.1 App 注册

```typescript
// main.ts
const explorerApp: ShellApp = {
  id: 'explorer',
  title: t('explorer'),
  icon: '📁',
  open: () => openExplorerWindow(wm, user, ctx),
};
controller.registerApps([serversApp, settingsApp, explorerApp]);
```

### 14.2 服务器数据共享

提取共享数据获取函数：

```typescript
// shared/server-data.ts
interface SavedServer {
  name: string;
  host: string;
  port: number;
  username: string;
  wsUrl: string;
}

async function fetchSavedServers(user: User): Promise<SavedServer[]>;
```

`ServerList`（servers-app）和 `ServerPicker`（explorer-app）都调用此函数。

### 14.3 移除旧 SFTP 面板

| 文件 | 变更 |
|------|------|
| `frontend/src/sftp-panel.ts` | 删除 |
| `frontend/src/apps/terminal-app.ts` | 移除 SFTPPanel 创建、toggle 按钮、onBack 面板关闭逻辑 |
| `frontend/src/style.css` | 移除 SFTP 面板相关样式 |
| `frontend/src/i18n/locales/*.ts` | 移除旧面板文案，新增资源管理器文案 |

### 14.4 跨 App 调用

`terminal-app.ts` 的 `createTerminalWindow()` 新增 `initialCommand` 参数，供资源管理器的"打开方式"菜单调用（nano/vim 编辑文件）。

---

## 15. i18n

新增翻译键（zh-CN / en-US）：

- `explorer` / `File Explorer`
- `explorerConnect` / `Select Server`
- `explorerSearch` / `Search files...`
- `explorerPaste` / `Paste`
- `explorerProperties` / `Properties`
- `explorerChmod` / `Permissions`
- `explorerCopy` / `Copy`
- `explorerMove` / `Move`
- `explorerDelete` / `Delete`
- `explorerRename` / `Rename`
- `explorerUpload` / `Upload`
- `explorerNewFolder` / `New Folder`
- `explorerRefresh` / `Refresh`
- `explorerSortBy` / `Sort by`
- `explorerSwitchServer` / `Switch Server`
- `explorerDisconnect` / `Disconnect`
- `explorerOpenWith` / `Open with`
- `explorerNewTab` / `New Tab`
- `explorerNewWindow` / `New Window`

---

## 16. 错误处理

| 场景 | 行为 |
|------|------|
| 连接失败 | 返回服务器选择页，显示错误提示 |
| 连接中断 | 文件列表上方显示断线横幅，提供重连按钮 |
| 操作失败（删除/chmod 等） | `notify()` 弹出错误提示，不改变当前状态 |
| 跨服务器 wget 失败 | 自动降级到浏览器中转，提示用户 |
| nano/vim 未安装 | 提示用户目标服务器未安装该编辑器 |
| R2 上传失败 | 降级到浏览器中转 |
