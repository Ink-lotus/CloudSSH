# Web SSH · 移动端外壳适配（Mobile Shell）— 设计规格

- 日期：2026-07-23
- 阶段：移动端外壳（框架前置，位于 SP1 与 SP2 之间）
- 基座：Fork 自 [newbietan/CloudSSH](https://github.com/newbietan/CloudSSH)（Apache-2.0），承接 SP1 桌面外壳

---

## 1. 背景与目标

SP1 已交付类 Windows 桌面外壳：`WindowManager`（浮动窗口、拖拽/缩放/最小最大化/z 序）、`Desktop`（壁纸/图标/任务栏/开始菜单/时钟），终端/SFTP 塞进窗口，接真实 VPS 跑通。

现在**先做移动端兼容**——趁功能还少，把"桌面 / 移动"双模式框架打好，避免后续 SP2/SP3 功能变多后难以塞进现有架构。

**核心诉求**（用户明确）：
- 移动端做成**类手机操作界面**：桌面图标→App 图标，**单击即开**（非双击）；开始菜单隐藏；改为**三键底栏**。
- 三键：**任务键**（唤出类 iOS 堆叠切换器，可滑动、单击选择）、**主界面键**（一键隐藏所有窗口回主界面）、**返回键**（上下文感知返回）。底栏从左到右顺序：**任务 · 主界面 · 返回**。
- **自动判断设备类型自动切换**桌面/移动；并**预留手动切换接口**（供平板外接鼠标切换操作方式）。

## 2. 范围

### 2.1 做什么（成功标准）

1. **双模式外壳**：`resolveMode()` 自动判定（触屏/窄屏→移动，鼠标/宽屏→桌面），可实时响应设备变化；设置 App 内可手动覆盖并持久化。
2. **移动外壳**：主界面图标网格（等间距对齐、无可见网格线、单击即开）、三键底栏（任务·主界面·返回）、堆叠任务切换器（滑动/单击选择/上滑关闭）。
3. **桌面外壳回归**：拖拽/缩放/最小最大化/任务栏/开始菜单行为与 SP1 完全一致。
4. **运行时切换不断会话**：切换模式时终端 SSH/SFTP 会话与滚动缓冲全部保留（`bodyEl` 及内部 xterm 不销毁）。
5. **触屏可用化**：连接表单、服务器列表、终端在触屏全屏下可用；终端提供**软键盘辅助条**（ESC/Ctrl/Alt/Tab/方向键等）。
6. **新增设置 App**：首项"显示模式（自动/桌面/移动）"，为 SP3 主题/壁纸预留占位区块。
7. **返回分发**：上下文感知返回（终端 App：SFTP 面板→切回终端、软键盘→收起；服务器 App：弹窗→关闭；栈空→回主界面）。

### 2.2 明确不做（YAGNI）

- SP2 资源管理器、SP3 主题/壁纸（设置 App 仅留占位区块）。
- 手势惯性物理、复杂窗口动画（切换器用简单 CSS transform）。
- 分屏/磁吸、多虚拟桌面。
- 登录方式改造（保持 GitHub OAuth + 匿名连接）。
- **登录前页面**（登录门 / 匿名连接表单）不放模式切换按钮——靠自动检测 + localStorage 持久化覆盖。

### 2.3 已确认决策

| 决策点 | 结论 |
|---|---|
| 实现架构 | 方案 B：呈现层分离。`WindowManager` 退为生命周期核心，呈现抽为 `DesktopShell`/`MobileShell` + `ShellController` |
| 移动窗口模型 | 单 App 全屏（一次显示一个），其余 `display:none`，经任务切换器切换 |
| 返回键 | 上下文感知：优先关闭当前 App 子层，栈空才回主界面 |
| 底栏顺序 | 任务 · 主界面 · 返回（从左到右） |
| 设备检测 | `matchMedia('(pointer:coarse)')`/`(hover:none)` + 视口宽度联合判断，监听变化 |
| 手动切换 | 新增设置 App 内的"显示模式"分段开关；`localStorage` 覆盖自动判断 |
| 运行时切换 | 不销毁窗口、不断会话；`bodyEl` 稳定，仅重装饰/重定位 |
| 软键盘辅助条 | 主行 `Esc Ctrl Alt Tab ↑↓←→`；展开 `…`：`\| ~ / - PgUp PgDn Home End Ctrl+C`；`Ctrl/Alt` 粘滞修饰 |
| App 模式感知 | `ShellController` 暴露 `getMode()`/`onModeChange()`，供终端软键盘辅助条与未来 SP2 双布局使用 |

## 3. 架构（方案 B：呈现层分离）

**总原则**：`WindowManager` 只管窗口生命周期；桌面/移动两套"外观与导航"互不知情；App 业务逻辑不因窗口机制而改（仅新增 `onBack` 注册与模式感知）；模式切换不销毁窗口。

### 3.1 `WindowManager` 瘦身为生命周期核心（改造 `wm/window-manager.ts`）

- **保留**：窗口记录、z 序、`activeId`、min/max 状态、`openWindow/focus/minimize/toggleMaximize/close`、`onChange` 事件、稳定的 `bodyEl`。
- **移出**：标题栏/按钮/拖拽/缩放这些"桌面外观"——迁至 `DesktopShell`。`openWindow` 只产出**裸窗口容器** `rootEl`（负责定位/尺寸）+ `bodyEl`（内容挂载点，**永不销毁/重建**）。`rootEl` 始终位于 `#window-host` 内，切换模式时**不移出**、仅由当前 Shell 重定位与增删装饰节点。
- `WindowHandle` 增补：`onBack(cb: () => boolean)`（返回是否已消费）；`rootEl` 只读暴露给 Shell 装饰。保留 `onResize/onClose/setTitle/setDisconnected`。

### 3.2 `Shell` 接口 + 两实现（新增 `shell/`）

```ts
interface Shell {
  mount(root: HTMLElement): void;      // 装载本外壳的导航/桌面 chrome
  unmount(): void;                     // 卸载本外壳的 chrome（不动 rootEl/bodyEl）
  renderWindow(rec): void;             // 装饰/定位单个窗口的 rootEl（不动 bodyEl）
  removeWindow(id: string): void;
  syncNav(items: NavItem[]): void;     // 桌面=任务栏；移动=切换器/底栏状态
  renderApps(apps: ShellApp[]): void;  // 桌面=图标+开始菜单；移动=主界面图标网格
}
```

- **`DesktopShell`**（`shell/desktop-shell.ts`）：把 SP1 的标题栏 DOM + 拖拽/缩放迁入 `renderWindow`；复用 `index.html` 现有 `#taskbar`/`#start-menu` 渲染导航与图标（行为与 SP1 完全一致）。
- **`MobileShell`**（`shell/mobile-shell.ts`）：`mount` 时向 `#desktop` 注入移动 chrome（主界面图标网格、三键底栏、切换器层）；`renderWindow` 把 `rootEl` 设为全屏、仅聚焦窗可见；`syncNav` 渲染切换器卡片。

### 3.3 `ShellController`（`shell/shell-controller.ts`，接管 SP1 `Desktop` 角色）

- 持有 `WindowManager` + 当前 `Shell`；订阅 `wm.onChange` → 驱动当前壳 `syncNav/renderWindow/removeWindow`。
- 模式：`resolveMode() = localStorage 覆盖 ?? detectMode(...)`；`matchMedia` 变化监听（平板插鼠标自动回桌面，未手动覆盖时）。
- `setMode(next)`：见 §5.2；`registerApps(apps)`；`handleBack()`（见 §4.3）。
- **App 模式感知**：暴露 `getMode(): 'desktop'|'mobile'` 与 `onModeChange(cb)`，以 `ShellContext` 形式传给 App 装配函数。

### 3.4 检测纯逻辑（新增 `shell/mode.ts`，可单测）

- `detectMode(mql, viewportWidth): Mode`——`(pointer:coarse)` 或 `(hover:none)` 且宽度 < 阈值（拟 820px）→ `mobile`，否则 `desktop`。
- `resolveMode(stored, detected): Mode`——`stored` 有值则覆盖，否则 `detected`。

## 4. 移动外壳交互

### 4.1 主界面
图标 = 已注册的 `ShellApp`（当前：服务器、设置）。4 列网格、等间距对齐、**无可见网格线/边框**、单击即开。

### 4.2 三键底栏（左→右：任务 · 主界面 · 返回）
- **任务键**：唤出堆叠任务切换器（横向卡片，`transform` 错位；滑动切换、单击 `focus`、上滑 `close`→走 `WM.close` 完整清理）。
- **主界面键**：隐藏所有窗口回主界面（窗口留后台、会话不断）。
- **返回键**：`ShellController.handleBack()`（见 §4.3）。

### 4.3 返回分发
`handleBack()` 取当前聚焦窗口，依次调其 `onBack` 处理器；任一返回 `true`（已消费）即停；全不消费则隐藏当前窗口回主界面。
- 终端 App 注册：SFTP 面板开→切回终端并 `return true`；软键盘辅助态需收起→收起 `return true`；否则 `return false`。
- 服务器 App 注册：增改服务器 modal 开→关闭 `return true`；否则 `false`。

### 4.4 终端软键盘辅助条（新增 `mobile/soft-key-bar.ts`）
- 仅移动模式挂载于终端窗口底部、吸附软键盘上方；`onModeChange` 切桌面时卸载。
- 主行 `Esc Ctrl Alt Tab ↑ ↓ ← →`；`…` 展开 `\| ~ / - PgUp PgDn Home End Ctrl+C`。
- `Ctrl/Alt` 粘滞修饰：点亮后与下一键组合发送。
- 经 `SSHTerminal` 现有输入通道发送控制序列（`Esc=\x1b`、`Ctrl+C=\x03`、`↑=\x1b[A` 等）。**实现首步确认 `SSHTerminal` 暴露的输入发送方法**。

### 4.5 设置 App · 显示模式（新增 `apps/settings-app.ts`）
分段开关"自动 / 桌面 / 移动"：选桌面/移动写 `localStorage` 并调 `ShellController.setMode`；选自动清除覆盖、恢复检测。为 SP3 预留主题/壁纸占位区块。

## 5. 数据流

### 5.1 移动模式连接一台服务器（复用 SP1，仅呈现层不同）
1. 加载 → `resolveMode()` 定模式 → `ShellController` 装对应 Shell。已登录进桌面；未登录显示匿名连接表单（触屏优化）。
2. 主界面单击「服务器」→ `WM.openWindow` → `MobileShell` 全屏呈现，内嵌 `ServerList`。
3. 点卡片连接 → `POST /api/servers/:id/connect` → `{wsUrl}` → `terminal-app` 挂 `SSHTerminal` 到 `bodyEl` → 全屏。
4. `sessionReady` → SFTP 可用；移动模式挂载软键盘辅助条。
5. 返回键按 §4.3；任务键切换器；上滑关窗完整清理（同 SP1）。

### 5.2 运行时切换模式（关键：不断会话）
`ShellController.setMode(next)`：
1. `oldShell.unmount()`：移除**装饰/导航节点**（桌面标题栏/任务栏/开始菜单 或 移动三键/切换器）；**不动** `rootEl/bodyEl`。
2. `newShell.mount()` 装新 chrome；按模式设置 `#window-host` 边界（桌面预留任务栏、移动预留三键底栏）。
3. 每个现存窗口 `newShell.renderWindow(rec)`：仅重定位/定尺寸 `rootEl`（桌面=浮动/上次位置、移动=全屏），`bodyEl` 原地不动。
4. 逐窗触发 `onResize` → `terminal.fit()`。
- **硬约束**：`rootEl` 不移出 `#window-host`、`bodyEl` 是稳定节点；Shell 只增删**兄弟装饰节点**、改 `rootEl` 定位样式，**绝不** `innerHTML` 清空 `bodyEl` → SSH/SFTP 会话与滚动缓冲全部保留。

## 6. 复用 / 替换 / 新增

- **原样复用**：全部后端；`SSHTerminal`、`SFTPPanel`、`ServerList`、`ConnectionForm`、`ui-feedback`、i18n、主题、所有 `/api/*` 与 WebSocket。
- **改造**
  - `wm/window-manager.ts`：瘦身为生命周期核心（移出桌面 chrome），`WindowHandle` 增 `onBack`、暴露 `rootEl`。
  - `wm/window-logic.ts`：`deriveTaskbar` 扩展/复用为切换器卡片派生。
  - `desktop.ts`：角色迁入 `shell/shell-controller.ts` + `shell/desktop-shell.ts`；`DesktopApp` 接口移至共享的 `shell/shell.ts`（更名 `ShellApp`）。
  - `main.ts`：以 `ShellController` 取代 `Desktop`；注册"设置"App；把 `ShellContext` 传给 App 装配。
  - `apps/terminal-app.ts`：注册 `onBack`；移动模式挂载软键盘辅助条；订阅 `onModeChange`。
  - `apps/servers-app.ts`：注册 `onBack`（关 modal）。
  - `index.html`：`#desktop`/`#window-host` 保留；`#taskbar`/`#start-menu` 由 `DesktopShell` 接管，移动 chrome 由 `MobileShell` 动态注入。
- **新增**：`shell/shell.ts`、`shell/desktop-shell.ts`、`shell/mobile-shell.ts`、`shell/shell-controller.ts`、`shell/mode.ts`、`apps/settings-app.ts`、`mobile/soft-key-bar.ts`。

## 7. 错误处理

- 沿用 SP1：`validateWsUrl`；连接失败/中断走 `SSHTerminal.sessionClosed`，窗口与切换器卡片显示"已断开"；关窗完整清理（`sftp.dispose`/`terminal.disconnect`/`dispose`/关 WS）。
- 新增：`matchMedia` 监听在 `ShellController` 销毁时解绑（防泄漏）；`setMode` 幂等（同模式 return）；切换器空态占位；主界面键重复按无副作用；软键盘辅助条卸载时解绑其事件。

## 8. 验证策略

- 构建/类型：`pnpm build` + `tsc --noEmit`（不加新依赖）。
- 纯逻辑单测（vitest，沿用现栈）：
  - `mode.ts`：`detectMode`（coarse+窄→mobile；fine→desktop）、`resolveMode`（覆盖优先）。
  - 返回分发：`handleBack` 依次询问、消费即停、栈空回主界面（假 handle 数组）。
  - 切换器卡片派生：由 WM 窗口集合派生（扩展 `deriveTaskbar`）。
- 手测清单：
  1. 窄屏/触屏自动进移动、宽屏鼠标自动进桌面。
  2. 移动：单击图标开 App；三键行为正确（返回上下文感知/主界面隐藏所有/任务切换）。
  3. 软键盘辅助条：`Esc`/`Ctrl+C`/方向键在 `vim`/`htop` 生效；`Ctrl/Alt` 粘滞正确。
  4. **运行时切换**：终端连着 `vim` 时在设置里切桌面/移动，会话不断、内容留存、尺寸自适应。
  5. 手动模式持久化（刷新仍生效）；改回自动恢复检测。
  6. 桌面模式回归：拖拽/缩放/最小最大化/任务栏/开始菜单与 SP1 一致。
  7. 平板插鼠标：`pointer` 变化触发自动模式切换（未手动覆盖时）。

## 9. SP2 前向兼容说明（暂缓，仅记方向）

SP2 资源管理器规划为**两套操作逻辑**：
- **桌面端**：沿用原方案——类 Windows 资源管理器（目录树 + 列表 + 右键 + 拖拽上传下载）。
- **移动端**：**MT 管理器**（安卓知名双栏文件管理器）式**双列窗口**。

本 SP 的 `ShellController.getMode()/onModeChange()` 已为其铺路：SP2 的资源管理器作为一个 App，按当前模式选择"Windows 布局 / MT 双列布局"，无需改动窗口机制。当前设计不得引入阻碍该分叉的假设（如把文件面板写死为单一布局）。

## 10. 风险与实现期需验证的假设

1. **`WindowManager` 瘦身重构**：把标题栏/拖拽/缩放从 `openWindow` 抽到 `DesktopShell` 时，须保证桌面行为零回归；实现首步先抽离并跑通桌面回归手测再做移动壳。
2. **`SSHTerminal` 输入发送 API**：软键盘辅助条依赖其暴露的发送方法/控制序列通道；实现首步读 `terminal.ts` 确认，缺则补最小适配。
3. **`xterm.fit()` 在模式切换的表现**：`rootEl` 尺寸剧变（浮动↔全屏）后需按帧/防抖 `fit()`；沿用 SP1 resize 策略。
4. **`bodyEl` 稳定性**：确认无任何路径会清空/重建 `bodyEl`（否则断会话）；以单测/评审守住 §5.2 硬约束。
5. **触屏软键盘遮挡**：软键盘弹出压缩视口，需用 `visualViewport` 或布局策略保证辅助条与输入可见；实现期实测。

## 11. 许可与署名

沿用 SP1：保留 CloudSSH `LICENSE`/`NOTICE`，README 注明基于 CloudSSH 二次开发并遵守 Apache-2.0 署名与变更声明。

## 12. 落地方式（属实现计划范畴，此处仅记方向）

先抽离 `WindowManager` chrome → 建 `DesktopShell` 跑通桌面回归 → 建 `mode.ts` + `ShellController` 双模式装载 → 建 `MobileShell`（主界面/三键/切换器/返回分发）→ 设置 App + 模式切换 → 终端软键盘辅助条 → 触屏可用化打磨 → 单测与手测。具体步骤、顺序与验证点在 writing-plans 阶段展开。
