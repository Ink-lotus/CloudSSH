# SP2 设计规格：资源管理器（File Explorer）

> 日期：2026-07-25
> 状态：设计定稿
> 前置：SP1 桌面外壳（已完成）、移动端外壳（已完成）

---

## 1. 概述

SP2 将现有的 SFTP 滑出面板替换为**独立的资源管理器 App**，提供类 Windows 资源管理器的文件浏览和管理体验。资源管理器与终端窗口完全解耦，自行管理服务器连接，支持跨服务器文件传输。

### 目标

- 独立 App，桌面图标 + 开始菜单 + 移动端主屏均有入口
- 桌面端：可收起目录树 + 详细列表 + 面包屑 + 工具栏 + 右键菜单 + 键盘快捷键
- 移动端：单面板 + 路径栏 + 竖三点文件菜单 + 全局菜单
- 全功能操作：复制/移动/粘贴、多选批量操作、chmod、搜索/过滤
- 文件编辑通过终端运行 nano
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
    explorer-state.ts            — 核心状态（路径、文件列表、选中、剪贴板、导航历史）
    explorer-actions.ts          — 业务操作（导航、CRUD、复制/移动、chmod、搜索）
    desktop-explorer.ts          — 桌面布局：可收起目录树 | 详细列表 + 面包屑 + 工具栏
    mobile-explorer.ts           — 移动布局：单面板
    context-menu.ts              — 右键菜单（桌面）/ 竖三点菜单（移动）
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
  → sftp-connection.ts 建立独立 WebSocket/SFTP 会话
  → 根据 ctx.getMode() 挂载 DesktopExplorer 或 MobileExplorer
  → ExplorerState 管理状态，ExplorerActions 处理操作
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
- 一个资源管理器窗口持有一个 `SFTPConnection` 实例

---

## 4. 核心状态 — ExplorerState

```typescript
interface ExplorerState {
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
  constructor(state: ExplorerState, connection: SFTPConnection);

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

  // 排序
  sort(by: SortKey, asc: boolean): void;
}
```

---

## 6. 跨服务器传输 — 三级策略

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

## 7. 桌面端 UI — DesktopExplorer

### 7.1 布局

```
┌──────────────────────────────────────────────────────┐
│ ← → ↑ 🏠 │ /home/user/documents           │ 🔍 搜索  │  工具栏 + 面包屑 + 搜索
├──────────┬───────────────────────────────────────────┤
│ ▶ 生产服务器│ 名称          大小    权限     修改时间   │  列头（可点击排序）
│ ▶ 测试机   │─────────────────────────────────────────│
│ ▼ 开发机 ● │ 📁 downloads    4K   drwxr-x  07-24 10:30│
│  ▼ /home  │ 📁 .ssh         4K   drwx---  07-20 09:15│
│   ▼ user  │ 📄 readme.txt  1.2K  -rw-r--  07-23 14:22│
│    docs   │ 📄 config.yml  340B  -rw-r--  07-22 11:05│
│    dl     │                                          │
│  ▶ var    │                                          │
├──────────┴──────────────────────────────────────────┤
│ 4 个项目 │ 已选中 1 项 (1.2 KB)          已连接 ●    │  状态栏
└─────────────────────────────────────────────────────┘
```

### 7.2 左侧树面板

- 默认折叠显示所有已保存的服务器
- 当前连接的服务器自动展开目录树
- 点击其他折叠服务器 → **断开当前连接**，建立新连接 → 展开目录树，切换右侧列表（单连接模型，一个窗口同一时间只连一台服务器）
- 要同时操作多台服务器，可打开多个资源管理器窗口
- 可收起整个树面板（只留面包屑导航）

### 7.3 交互

| 操作 | 行为 |
|------|------|
| 单击文件 | 选中（清除其他选中） |
| Ctrl+单击 | 切换选中（多选） |
| Shift+单击 | 范围选中 |
| 双击文件夹 | 导航进入 |
| 双击文本文件 | 打开终端运行 nano 编辑 |
| 双击二进制/未知文件 | 下载 |
| 右键 | 弹出上下文菜单 |
| 拖拽本地文件到列表区 | 上传 |
| Ctrl+C / Ctrl+X / Ctrl+V | 复制 / 剪切 / 粘贴 |
| Delete 键 | 删除选中项（确认对话框） |
| F2 | 重命名选中项 |
| 面包屑点击 | 导航到对应层级 |
| 目录树节点点击 | 导航到该目录 |
| 列头点击 | 按该列排序，再次点击反转 |

### 7.4 右键菜单

选中文件时：`打开 / 下载 / 复制 / 移动 / 删除 / 重命名 / 属性(chmod)`

选中文件夹时：`打开 / 复制 / 移动 / 删除 / 重命名 / 属性(chmod)`

空白区域：`上传文件 / 新建文件夹 / 粘贴 / 刷新`

---

## 8. 移动端 UI — MobileExplorer

### 8.1 布局

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

### 8.2 全局菜单 [≡]

`上传文件 / 新建文件夹 / 搜索 / 粘贴（剪贴板有内容时显示）/ 排序方式 / 刷新 / 切换服务器 / 断开连接`

### 8.3 竖三点文件菜单 ⋮

`复制 / 移动 / 删除 / 重命名 / 属性`

### 8.4 交互

- 点击文件夹：导航进入
- 点击文本文件：打开终端运行 nano 编辑
- 点击二进制/未知文件：下载
- 长按文件：进入多选模式，底部浮出批量操作栏
- 复制/移动操作后，`[≡]` 菜单出现"粘贴"选项，导航到目标目录后点"粘贴"执行
- 返回键行为：返回上一级目录，已在根目录则关闭资源管理器

### 8.5 与 MobileShell 集成

- 资源管理器窗口在 MobileShell 中全屏显示
- `onBack` 回调：先回退目录，目录栈为空则关闭窗口

---

## 9. 文件编辑

不自建编辑器，通过终端运行 nano：

```
双击文件（桌面端）/ 点击文件（移动端）
  → 判断文件类型（按扩展名）
    → 文本文件（.txt/.md/.yml/.json/.conf/.sh/.py/.js/.ts/.xml/.html/.css/.log 等）
      → explorer-app 调用 createTerminalWindow()
        - wsUrl: 同一服务器的连接信息
        - initialCommand: "nano /path/to/file"
      → 新终端窗口打开，自动运行 nano
    → 二进制/未知文件
      → 直接下载
```

终端 App 增强：`createTerminalWindow()` 新增 `initialCommand` 参数。

降级处理：若服务器未安装 nano，尝试 `vi`；都没有则提示用户。

---

## 10. 搜索/过滤

| 模式 | 触发 | 实现 |
|------|------|------|
| 即时过滤 | 搜索框输入 | 客户端 `name.includes(query)` 过滤 |
| 远程搜索 | 按回车/点搜索按钮 | SSH exec `find . -name "*query*" -maxdepth 5` |

远程搜索结果以平面列表展示（显示完整路径），双击/点击导航到文件所在目录。

---

## 11. 属性面板（chmod）

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

## 12. 后端变更

### 12.1 SFTPHandler 扩展

| 新增操作 | 说明 |
|---------|------|
| `chmod` | 调用 SFTP `setstat` 设置文件权限 |
| `readTextFile` | 小文件全量读取返回文本内容 |
| `exec` | SSH exec 通道执行命令（`cp`、`wget`、`find`） |

### 12.2 跨服务器传输 — Worker 端

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

## 13. 集成与迁移

### 13.1 App 注册

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

### 13.2 服务器数据共享

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

### 13.3 移除旧 SFTP 面板

| 文件 | 变更 |
|------|------|
| `frontend/src/sftp-panel.ts` | 删除 |
| `frontend/src/apps/terminal-app.ts` | 移除 SFTPPanel 创建、toggle 按钮、onBack 面板关闭逻辑 |
| `frontend/src/style.css` | 移除 SFTP 面板相关样式 |
| `frontend/src/i18n/locales/*.ts` | 移除旧面板文案，新增资源管理器文案 |

### 13.4 跨 App 调用

`terminal-app.ts` 的 `createTerminalWindow()` 新增 `initialCommand` 参数，供资源管理器调用以打开 nano 编辑文件。

---

## 14. i18n

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

---

## 15. 错误处理

| 场景 | 行为 |
|------|------|
| 连接失败 | 返回服务器选择页，显示错误提示 |
| 连接中断 | 文件列表上方显示断线横幅，提供重连按钮 |
| 操作失败（删除/chmod 等） | `notify()` 弹出错误提示，不改变当前状态 |
| 跨服务器 wget 失败 | 自动降级到浏览器中转，提示用户 |
| nano 未安装 | 尝试 `vi`，都没有则提示用户 |
| R2 上传失败 | 降级到浏览器中转 |
