# 移动端外壳（桌面/移动双模式）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 SP1 桌面外壳基础上，加一层"桌面/移动"双模式外壳——移动端为单 App 全屏 + 三键底栏 + 堆叠切换器，自动检测设备并可手动切换，运行时切换不断 SSH 会话；并让终端在触屏下可用（软键盘辅助条 + 面板打磨）。

**架构：** 方案 B 呈现层分离。`WindowManager` 瘦身为"窗口生命周期核心"（记录/z 序/事件/裸 `rootEl`+`bodyEl`），所有外观交给实现 `Shell` 接口的两个呈现层：`DesktopShell`（浮动窗口+任务栏+开始菜单，行为=SP1）与 `MobileShell`（全屏+三键+切换器）。`ShellController` 持有 WM 与当前 Shell、检测/切换模式，切换时只重装饰/重定位 `rootEl`（`bodyEl` 及内部 xterm 永不销毁）。App 层只新增 `onBack` 注册与（终端）模式感知。

**技术栈：** TypeScript（`frontend/tsconfig.json`，strict、DOM lib）、Vite/build-html 产物、vitest（`node` 环境，仅纯逻辑单测）。不新增依赖。

**规格：** `docs/superpowers/specs/2026-07-23-webssh-mobile-shell-design.md`

---

## 范围与阶段

规格范围 = "外壳 + 触屏可用"。本计划分两阶段，**每阶段结束都是可工作、可测试、可交付的软件**：

- **阶段一（任务 A–D）：双模式外壳框架。** 完成后桌面模式与 SP1 完全一致，移动模式可用（主界面/三键/切换器/返回），设置里可手动切换且运行时不断会话。
- **阶段二（任务 E–F）：触屏可用化。** 终端软键盘辅助条 + 连接表单/服务器列表/终端的触屏打磨。

若需拆成两个独立计划执行，以任务 D 结束为界天然可切分。

## 文件结构

**新增**
- `frontend/src/shell/types.ts` — 共享类型：`Mode`、`ShellApp`、`WindowView`、`WindowActions`、`Shell`、`ShellContext`。
- `frontend/src/shell/mode.ts` — 纯 `detectMode`/`resolveMode` + 运行时包装（`detectRuntimeMode`、`readStoredSelection`、`writeStoredSelection`）。
- `frontend/src/shell/back-dispatch.ts` — 纯 `dispatchBack(handlers)`。
- `frontend/src/shell/desktop-shell.ts` — `DesktopShell implements Shell`（迁入 SP1 的标题栏/拖拽/缩放/最大化 + 任务栏/开始菜单/图标/时钟）。
- `frontend/src/shell/mobile-shell.ts` — `MobileShell implements Shell`（全屏窗口宿主 + 主界面图标网格 + 三键底栏 + 堆叠切换器 + 返回分发）。
- `frontend/src/shell/shell-controller.ts` — `ShellController`（接管 SP1 `Desktop` 角色）。
- `frontend/src/apps/settings-app.ts` — 设置 App（显示模式分段开关 + SP3 占位）。
- `frontend/src/mobile/soft-key-bar.ts` — 终端软键盘辅助条（阶段二）。
- `tests/shell/mode.test.ts`、`tests/shell/back-dispatch.test.ts` — 纯逻辑单测。

**改造**
- `frontend/src/wm/window-manager.ts` — 瘦身：去 chrome，裸 `rootEl`+`bodyEl`，新增 `onBack`/事件/`listViews`/`handleBack`/`fireResize*`。
- `frontend/src/main.ts` — 用 `ShellController` 取代 `Desktop`；注册"设置"App；把 `ShellContext` 传给终端 App。
- `frontend/src/apps/terminal-app.ts` — 注册 `onBack`；（阶段二）移动模式挂软键盘辅助条。
- `frontend/src/apps/servers-app.ts` — 注册 `onBack`（关 `#server-modal`）。

**删除**：`frontend/src/desktop.ts`（角色迁入 `shell/`，任务 B 末删除）。

---

## 任务 A：纯逻辑与共享类型

**文件：**
- 创建：`frontend/src/shell/types.ts`
- 创建：`frontend/src/shell/back-dispatch.ts`
- 创建：`frontend/src/shell/mode.ts`
- 测试：`tests/shell/back-dispatch.test.ts`、`tests/shell/mode.test.ts`

- [ ] **步骤 1：写共享类型 `frontend/src/shell/types.ts`**

```ts
// 双模式外壳的共享类型（无 DOM 依赖的部分可被纯逻辑复用）
export type Mode = 'desktop' | 'mobile';
export type ModeSelection = 'auto' | 'desktop' | 'mobile';

/** 主界面/开始菜单里的一个可打开 App */
export interface ShellApp {
  id: string;
  title: string;
  icon: string;      // Material Symbols 图标名
  open: () => void;
}

/** WindowManager 暴露给 Shell 的只读窗口视图 */
export interface WindowView {
  id: string;
  rootEl: HTMLElement;   // 裸容器；Shell 负责装饰/定位/可见性
  title: string;
  icon: string;
  active: boolean;
  minimized: boolean;
  defaultWidth: number;  // 桌面浮动初始尺寸（移动忽略）
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
}

/** Shell 可对窗口执行的生命周期动作（由 WindowManager 结构化实现） */
export interface WindowActions {
  focus(id: string): void;
  minimize(id: string): void;
  close(id: string): void;
  fireResize(id: string): void;
}

/** 呈现层接口：桌面/移动各一实现 */
export interface Shell {
  mount(): void;                 // 装载本外壳 chrome + 设置 #window-host 边界
  unmount(): void;               // 卸载本外壳 chrome（不动 rootEl/bodyEl）
  renderWindow(view: WindowView): void;   // 装饰/定位单个窗口的 rootEl
  removeWindow(id: string): void;
  syncState(views: WindowView[], activeId: string | null): void; // 可见性/导航/激活态
  renderApps(apps: ShellApp[]): void;
}

/** 传给 App 的模式上下文（终端软键盘辅助条、未来 SP2 双布局用） */
export interface ShellContext {
  getMode(): Mode;
  onModeChange(cb: (mode: Mode) => void): () => void; // 返回取消订阅
}
```

- [ ] **步骤 2：写失败测试 `tests/shell/back-dispatch.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { dispatchBack } from '../../frontend/src/shell/back-dispatch';

describe('dispatchBack', () => {
  it('无处理器时返回 false（未消费）', () => {
    expect(dispatchBack([])).toBe(false);
  });
  it('后注册的处理器先被询问（LIFO），消费即停', () => {
    const calls: string[] = [];
    const handlers = [
      () => { calls.push('a'); return false; },
      () => { calls.push('b'); return true; },
      () => { calls.push('c'); return false; },
    ];
    expect(dispatchBack(handlers)).toBe(true);
    expect(calls).toEqual(['c', 'b']); // c 先问返回 false，b 返回 true 停止；a 不问
  });
  it('全部不消费时返回 false', () => {
    expect(dispatchBack([() => false, () => false])).toBe(false);
  });
});
```

- [ ] **步骤 3：运行验证失败**

运行：`pnpm test -- tests/shell/back-dispatch.test.ts`
预期：FAIL，报 "Cannot find module '.../back-dispatch'"。

- [ ] **步骤 4：写实现 `frontend/src/shell/back-dispatch.ts`**

```ts
// 上下文感知返回：按 LIFO 依次询问处理器，任一返回 true（已消费）即停。
export function dispatchBack(handlers: Array<() => boolean>): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]()) return true;
  }
  return false;
}
```

- [ ] **步骤 5：运行验证通过**

运行：`pnpm test -- tests/shell/back-dispatch.test.ts`
预期：PASS（3 个用例）。

- [ ] **步骤 6：写失败测试 `tests/shell/mode.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { detectMode, resolveMode } from '../../frontend/src/shell/mode';

describe('detectMode', () => {
  it('触屏(coarse)且窄屏 → mobile', () => {
    expect(detectMode({ pointerCoarse: true, hoverNone: true, width: 400 })).toBe('mobile');
  });
  it('触屏但宽屏（平板横屏）→ desktop', () => {
    expect(detectMode({ pointerCoarse: true, hoverNone: true, width: 1024 })).toBe('desktop');
  });
  it('鼠标(fine)窄窗口 → desktop（桌面缩小窗口不误判）', () => {
    expect(detectMode({ pointerCoarse: false, hoverNone: false, width: 500 })).toBe('desktop');
  });
  it('阈值可配置', () => {
    expect(detectMode({ pointerCoarse: true, hoverNone: false, width: 700 }, 600)).toBe('desktop');
  });
});

describe('resolveMode', () => {
  it('有手动覆盖时覆盖优先', () => {
    expect(resolveMode('desktop', 'mobile')).toBe('desktop');
  });
  it('无覆盖时用检测结果', () => {
    expect(resolveMode(null, 'mobile')).toBe('mobile');
  });
});
```

- [ ] **步骤 7：运行验证失败**

运行：`pnpm test -- tests/shell/mode.test.ts`
预期：FAIL，模块不存在。

- [ ] **步骤 8：写实现 `frontend/src/shell/mode.ts`**

```ts
import type { Mode, ModeSelection } from './types';

const MOBILE_WIDTH_THRESHOLD = 820;
const STORAGE_KEY = 'cloudssh_display_mode';

export interface DeviceSignals {
  pointerCoarse: boolean; // matchMedia('(pointer: coarse)').matches
  hoverNone: boolean;     // matchMedia('(hover: none)').matches
  width: number;          // 视口宽度
}

/** 纯判定：主指针为触屏且视口窄 → mobile，否则 desktop */
export function detectMode(sig: DeviceSignals, threshold = MOBILE_WIDTH_THRESHOLD): Mode {
  const touchLike = sig.pointerCoarse || sig.hoverNone;
  return touchLike && sig.width < threshold ? 'mobile' : 'desktop';
}

/** 手动覆盖优先，否则用检测结果 */
export function resolveMode(stored: Mode | null, detected: Mode): Mode {
  return stored ?? detected;
}

// ---- 运行时包装（薄，不单测）----

/** 读取当前设备信号并判定模式 */
export function detectRuntimeMode(): Mode {
  return detectMode({
    pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
    hoverNone: window.matchMedia('(hover: none)').matches,
    width: window.innerWidth,
  });
}

/** 读手动覆盖：'auto'/缺省 → null（跟随检测） */
export function readStoredSelection(): Mode | null {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'desktop' || v === 'mobile' ? v : null;
}

/** 写手动覆盖：'auto' → 清除，跟随检测 */
export function writeStoredSelection(sel: ModeSelection): void {
  if (sel === 'auto') localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, sel);
}

/** 供设置 App 回显当前选择 */
export function readSelection(): ModeSelection {
  return readStoredSelection() ?? 'auto';
}
```

- [ ] **步骤 9：运行验证通过**

运行：`pnpm test -- tests/shell/mode.test.ts`
预期：PASS（6 个用例）。

- [ ] **步骤 10：Commit**

```bash
git add frontend/src/shell/types.ts frontend/src/shell/back-dispatch.ts frontend/src/shell/mode.ts tests/shell/
git commit -m "feat(shell): 双模式纯逻辑与类型（mode/back-dispatch/types）"
```

---

## 任务 B：WindowManager 瘦身 + DesktopShell + ShellController（桌面回归绿）

此任务是原子重构：完成后桌面模式行为与 SP1 一致。中间步骤不单独 commit，**待步骤末桌面手测通过再一次性提交**。

**文件：**
- 修改（整文件替换）：`frontend/src/wm/window-manager.ts`
- 创建：`frontend/src/shell/desktop-shell.ts`
- 创建：`frontend/src/shell/shell-controller.ts`
- 修改：`frontend/src/main.ts:1-50`（引导装配）
- 删除：`frontend/src/desktop.ts`

- [ ] **步骤 1：整文件替换 `frontend/src/wm/window-manager.ts`**

```ts
import { topZIndex } from './window-logic';
import { dispatchBack } from '../shell/back-dispatch';
import type { WindowView, WindowActions } from '../shell/types';

export interface OpenWindowOptions {
  title: string;
  icon: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
}

export interface WindowHandle {
  readonly id: string;
  readonly bodyEl: HTMLElement;
  focus(): void;
  minimize(): void;
  close(): void;
  setTitle(title: string): void;
  setDisconnected(disconnected: boolean): void;
  onResize(cb: () => void): void;
  onClose(cb: () => void): void;
  onBack(cb: () => boolean): void;   // 返回是否已消费
}

interface WinRecord {
  id: string;
  opts: OpenWindowOptions;
  rootEl: HTMLDivElement;
  bodyEl: HTMLElement;
  zIndex: number;
  minimized: boolean;
  resizeCbs: Array<() => void>;
  closeCbs: Array<() => void>;
  backCbs: Array<() => boolean>;
}

const BASE_Z = 100;

/**
 * 窗口生命周期核心：只管记录、z 序、激活/最小化状态、裸 rootEl+bodyEl 与事件。
 * 不生成任何外观（标题栏/按钮/拖拽/缩放/可见性），这些由 Shell 呈现层负责。
 * 结构化实现 WindowActions，可直接作为 Shell 的动作入口。
 */
export class WindowManager implements WindowActions {
  private host: HTMLElement;
  private wins = new Map<string, WinRecord>();
  private order: string[] = [];         // 打开顺序，稳定任务栏/切换器顺序
  private activeId: string | null = null;
  private counter = 0;
  private changeCbs: Array<(views: WindowView[], activeId: string | null) => void> = [];
  private openedCbs: Array<(view: WindowView) => void> = [];
  private closedCbs: Array<(id: string) => void> = [];

  constructor(host: HTMLElement) { this.host = host; }

  onChange(cb: (views: WindowView[], activeId: string | null) => void): void { this.changeCbs.push(cb); }
  onWindowOpened(cb: (view: WindowView) => void): void { this.openedCbs.push(cb); }
  onWindowClosed(cb: (id: string) => void): void { this.closedCbs.push(cb); }

  getActiveId(): string | null { return this.activeId; }

  listViews(): WindowView[] {
    return this.order.map((id) => this.viewOf(this.wins.get(id)!));
  }

  private viewOf(rec: WinRecord): WindowView {
    return {
      id: rec.id, rootEl: rec.rootEl,
      title: rec.opts.title, icon: rec.opts.icon,
      active: rec.id === this.activeId, minimized: rec.minimized,
      defaultWidth: rec.opts.width ?? 720, defaultHeight: rec.opts.height ?? 460,
      minWidth: rec.opts.minWidth ?? 320, minHeight: rec.opts.minHeight ?? 200,
    };
  }

  private emitChange(): void {
    const views = this.listViews();
    this.changeCbs.forEach((cb) => cb(views, this.activeId));
  }

  openWindow(opts: OpenWindowOptions): WindowHandle {
    const id = `win-${++this.counter}`;
    const rootEl = document.createElement('div');
    rootEl.className = 'wm-window';
    // 裸容器：定位/尺寸/可见性交给 Shell；默认隐藏，Shell renderWindow 后显示
    rootEl.style.cssText =
      'position:absolute;display:none;flex-direction:column;overflow:hidden;' +
      'background:var(--bg-surface,#12151c);';
    const bodyEl = document.createElement('div');
    bodyEl.className = 'wm-body';
    bodyEl.style.cssText = 'flex:1;min-height:0;position:relative;overflow:hidden;';
    rootEl.appendChild(bodyEl);
    this.host.appendChild(rootEl);

    const rec: WinRecord = {
      id, opts, rootEl, bodyEl, zIndex: BASE_Z,
      minimized: false, resizeCbs: [], closeCbs: [], backCbs: [],
    };
    this.wins.set(id, rec);
    this.order.push(id);

    rootEl.addEventListener('pointerdown', () => this.focus(id));

    this.openedCbs.forEach((cb) => cb(this.viewOf(rec)));
    this.focus(id);
    return this.makeHandle(rec);
  }

  focus(id: string): void {
    const rec = this.wins.get(id);
    if (!rec) return;
    rec.minimized = false;
    const zs = Array.from(this.wins.values()).map((w) => w.zIndex);
    rec.zIndex = topZIndex(zs, BASE_Z);
    rec.rootEl.style.zIndex = String(rec.zIndex);
    this.activeId = id;
    this.emitChange();
  }

  minimize(id: string): void {
    const rec = this.wins.get(id);
    if (!rec) return;
    rec.minimized = true;
    if (this.activeId === id) this.activeId = null;
    this.emitChange();
  }

  close(id: string): void {
    const rec = this.wins.get(id);
    if (!rec) return;
    rec.closeCbs.forEach((cb) => cb());
    rec.rootEl.remove();
    this.wins.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (this.activeId === id) this.activeId = null;
    this.closedCbs.forEach((cb) => cb(id));
    this.emitChange();
  }

  /** 移动返回键：询问该窗口注册的 onBack 处理器 */
  handleBack(id: string | null): boolean {
    if (!id) return false;
    const rec = this.wins.get(id);
    return rec ? dispatchBack(rec.backCbs) : false;
  }

  fireResize(id: string): void {
    this.wins.get(id)?.resizeCbs.forEach((cb) => cb());
  }

  fireResizeAll(): void {
    this.wins.forEach((rec) => rec.resizeCbs.forEach((cb) => cb()));
  }

  setTitle(id: string, title: string): void {
    const rec = this.wins.get(id);
    if (!rec) return;
    rec.opts.title = title;
    this.emitChange();
  }

  private makeHandle(rec: WinRecord): WindowHandle {
    return {
      id: rec.id,
      bodyEl: rec.bodyEl,
      focus: () => this.focus(rec.id),
      minimize: () => this.minimize(rec.id),
      close: () => this.close(rec.id),
      setTitle: (t: string) => this.setTitle(rec.id, t),
      setDisconnected: (d: boolean) => rec.rootEl.classList.toggle('wm-disconnected', d),
      onResize: (cb: () => void) => { rec.resizeCbs.push(cb); },
      onClose: (cb: () => void) => { rec.closeCbs.push(cb); },
      onBack: (cb: () => boolean) => { rec.backCbs.push(cb); },
    };
  }
}
```

> 注：`window-logic.ts` 的 `clampPosition`/`deriveTaskbar` 仍被 DesktopShell 复用，保持不动。移除了 `toggleMaximize`（改由 DesktopShell 内部处理最大化）。

- [ ] **步骤 2：创建 `frontend/src/shell/desktop-shell.ts`**

迁入 SP1 `window-manager.ts` 的标题栏/拖拽/缩放/最大化与 `desktop.ts` 的任务栏/开始菜单/图标/时钟。复用 `index.html` 现有 `#taskbar`/`#taskbar-items`/`#start-btn`/`#start-menu`/`#desktop-icons`/`#taskbar-clock` 节点。

```ts
import { clampPosition } from '../wm/window-logic';
import type { Shell, ShellApp, WindowView, WindowActions } from './types';

interface Geom { x: number; y: number; w: number; h: number; }
interface Deco {
  titlebar: HTMLElement;
  titleEl: HTMLElement;
  resizeEl: HTMLElement;
  geom: Geom;
  maximized: boolean;
  prevRect?: Geom;
  cleanup: () => void;
}

const TASKBAR_H = 48;

/** 桌面呈现层：浮动窗口 + 任务栏 + 开始菜单 + 图标 + 时钟（行为=SP1） */
export class DesktopShell implements Shell {
  private actions: WindowActions;
  private host: HTMLElement;
  private decos = new Map<string, Deco>();
  private openCount = 0;
  private apps: ShellApp[] = [];
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private startBtnHandler = (e: Event) => { e.stopPropagation(); this.toggleStartMenu(); };
  private docClickHandler = () => this.hideStartMenu();

  constructor(host: HTMLElement, actions: WindowActions) {
    this.host = host;
    this.actions = actions;
  }

  mount(): void {
    this.host.style.bottom = `${TASKBAR_H}px`;
    document.getElementById('taskbar')!.style.display = '';
    document.getElementById('desktop-icons')!.style.display = '';
    document.getElementById('start-btn')!.addEventListener('click', this.startBtnHandler);
    document.addEventListener('click', this.docClickHandler);
    this.startClock();
  }

  unmount(): void {
    document.getElementById('start-btn')!.removeEventListener('click', this.startBtnHandler);
    document.removeEventListener('click', this.docClickHandler);
    this.hideStartMenu();
    if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = null; }
    document.getElementById('taskbar')!.style.display = 'none';
    document.getElementById('desktop-icons')!.style.display = 'none';
    // 卸掉每个窗口的桌面装饰（保留 rootEl/bodyEl）
    for (const id of Array.from(this.decos.keys())) this.stripDeco(id);
  }

  renderWindow(view: WindowView): void {
    if (this.decos.has(view.id)) { this.applyGeom(view.id); return; }
    const rootEl = view.rootEl;

    // 初始几何：级联
    const offset = (this.openCount++ % 6) * 28;
    const start = clampPosition(
      80 + offset, 60 + offset, view.defaultWidth, view.defaultHeight,
      window.innerWidth, window.innerHeight, TASKBAR_H,
    );
    const geom: Geom = { x: start.x, y: start.y, w: view.defaultWidth, h: view.defaultHeight };

    // 标题栏
    const titlebar = document.createElement('div');
    titlebar.className = 'wm-titlebar';
    titlebar.style.cssText =
      'height:34px;flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:0 8px;' +
      'background:var(--bg-elevated,#0d1017);cursor:move;user-select:none;';
    titlebar.innerHTML =
      `<span class="material-symbols-outlined" style="font-size:16px;opacity:.8;">${view.icon}</span>` +
      `<span class="wm-title" style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escape(view.title)}</span>` +
      `<button class="wm-min" title="最小化" style="width:26px;height:24px;">&#8211;</button>` +
      `<button class="wm-max" title="最大化" style="width:26px;height:24px;">&#9633;</button>` +
      `<button class="wm-close" title="关闭" style="width:26px;height:24px;">&#10005;</button>`;
    rootEl.insertBefore(titlebar, rootEl.firstChild);

    // 缩放柄
    const resizeEl = document.createElement('div');
    resizeEl.className = 'wm-resize';
    resizeEl.style.cssText = 'position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;';
    rootEl.appendChild(resizeEl);

    const titleEl = titlebar.querySelector('.wm-title') as HTMLElement;
    const deco: Deco = { titlebar, titleEl, resizeEl, geom, maximized: false, cleanup: () => {} };
    this.decos.set(view.id, deco);

    // 按钮
    const minBtn = titlebar.querySelector('.wm-min') as HTMLElement;
    const maxBtn = titlebar.querySelector('.wm-max') as HTMLElement;
    const closeBtn = titlebar.querySelector('.wm-close') as HTMLElement;
    const onMin = (e: Event) => { e.stopPropagation(); this.actions.minimize(view.id); };
    const onMax = (e: Event) => { e.stopPropagation(); this.toggleMaximize(view.id); };
    const onClose = (e: Event) => { e.stopPropagation(); this.actions.close(view.id); };
    minBtn.addEventListener('click', onMin);
    maxBtn.addEventListener('click', onMax);
    closeBtn.addEventListener('click', onClose);

    const cleanupDrag = this.enableDrag(view.id, titlebar);
    const cleanupResize = this.enableResize(view.id, resizeEl);
    deco.cleanup = () => {
      minBtn.removeEventListener('click', onMin);
      maxBtn.removeEventListener('click', onMax);
      closeBtn.removeEventListener('click', onClose);
      cleanupDrag(); cleanupResize();
      titlebar.remove(); resizeEl.remove();
    };

    rootEl.style.display = 'flex';
    this.applyGeom(view.id);
  }

  removeWindow(id: string): void { this.stripDeco(id); }

  syncState(views: WindowView[], _activeId: string | null): void {
    // 可见性：非最小化即显示；标题回填；任务栏渲染
    for (const v of views) {
      const deco = this.decos.get(v.id);
      if (deco) {
        v.rootEl.style.display = v.minimized ? 'none' : 'flex';
        deco.titleEl.textContent = v.title;
      }
    }
    this.renderTaskbar(views);
  }

  renderApps(apps: ShellApp[]): void {
    this.apps = apps;
    this.renderIcons();
    this.renderStartMenu();
  }

  // ---- 最大化 / 几何 ----
  private applyGeom(id: string): void {
    const deco = this.decos.get(id); if (!deco) return;
    const rootEl = document.querySelector<HTMLElement>(`[data-wm-id]`); // 占位，见下
    const el = this.rootOf(id); if (!el) return;
    const g = deco.maximized
      ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight - TASKBAR_H }
      : deco.geom;
    el.style.left = `${g.x}px`; el.style.top = `${g.y}px`;
    el.style.width = `${g.w}px`; el.style.height = `${g.h}px`;
    el.style.minWidth = ''; el.style.minHeight = '';
  }

  private rootOf(id: string): HTMLElement | null {
    // rootEl 在 decos 里通过 titlebar.parentElement 取得
    return this.decos.get(id)?.titlebar.parentElement as HTMLElement | null;
  }

  private toggleMaximize(id: string): void {
    const deco = this.decos.get(id); const el = this.rootOf(id);
    if (!deco || !el) return;
    if (!deco.maximized) {
      deco.prevRect = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      deco.maximized = true;
    } else if (deco.prevRect) {
      deco.geom = deco.prevRect;
      deco.maximized = false;
    }
    this.applyGeom(id);
    this.actions.fireResize(id);
  }

  private enableDrag(id: string, handle: HTMLElement): () => void {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const deco = this.decos.get(id); if (deco?.maximized) return;
      const el = this.rootOf(id)!; dragging = true;
      sx = e.clientX; sy = e.clientY; ox = el.offsetLeft; oy = el.offsetTop;
      handle.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const deco = this.decos.get(id)!; const el = this.rootOf(id)!;
      const p = clampPosition(ox + (e.clientX - sx), oy + (e.clientY - sy),
        el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight, TASKBAR_H);
      deco.geom = { x: p.x, y: p.y, w: el.offsetWidth, h: el.offsetHeight };
      el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    return () => {
      handle.removeEventListener('pointerdown', down);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
  }

  private enableResize(id: string, handle: HTMLElement): () => void {
    let sx = 0, sy = 0, ow = 0, oh = 0, resizing = false;
    const down = (e: PointerEvent) => {
      e.stopPropagation(); const el = this.rootOf(id)!; resizing = true;
      sx = e.clientX; sy = e.clientY; ow = el.offsetWidth; oh = el.offsetHeight;
      handle.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!resizing) return;
      const v = this.decos.get(id)!; const el = this.rootOf(id)!;
      const minW = 320, minH = 200;
      const w = Math.max(minW, ow + (e.clientX - sx));
      const h = Math.max(minH, oh + (e.clientY - sy));
      el.style.width = `${w}px`; el.style.height = `${h}px`;
      v.geom = { x: el.offsetLeft, y: el.offsetTop, w, h };
      this.actions.fireResize(id);
    };
    const up = (e: PointerEvent) => {
      resizing = false;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      this.actions.fireResize(id);
    };
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    return () => {
      handle.removeEventListener('pointerdown', down);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
  }

  private stripDeco(id: string): void {
    const deco = this.decos.get(id);
    if (!deco) return;
    deco.cleanup();
    this.decos.delete(id);
  }

  // ---- 任务栏 / 开始菜单 / 图标 / 时钟（迁自 SP1 desktop.ts）----
  private renderTaskbar(views: WindowView[]): void {
    const el = document.getElementById('taskbar-items')!;
    el.innerHTML = '';
    for (const it of views) {
      const btn = document.createElement('button');
      btn.className = `px-3 h-9 flex items-center gap-2 text-xs rounded ${it.active ? 'bg-white/15' : 'hover:bg-white/10'} ${it.minimized ? 'opacity-60' : ''}`;
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">${it.icon}</span><span class="max-w-[120px] truncate">${this.escape(it.title)}</span>`;
      btn.addEventListener('click', () => {
        if (it.active && !it.minimized) this.actions.minimize(it.id);
        else this.actions.focus(it.id);
      });
      el.appendChild(btn);
    }
  }

  private renderIcons(): void {
    const el = document.getElementById('desktop-icons')!;
    el.innerHTML = '';
    for (const app of this.apps) {
      const icon = document.createElement('button');
      icon.className = 'w-20 h-20 flex flex-col items-center justify-center gap-1 text-xs rounded hover:bg-white/10';
      icon.innerHTML = `<span class="material-symbols-outlined" style="font-size:28px;">${app.icon}</span><span>${this.escape(app.title)}</span>`;
      icon.addEventListener('dblclick', () => app.open());
      el.appendChild(icon);
    }
  }

  private renderStartMenu(): void {
    const menu = document.getElementById('start-menu')!;
    menu.innerHTML = '';
    for (const app of this.apps) {
      const item = document.createElement('button');
      item.className = 'w-full flex items-center gap-2 px-2 py-2 text-sm text-left hover:bg-white/10';
      item.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px;">${app.icon}</span>${this.escape(app.title)}`;
      item.addEventListener('click', () => { menu.classList.add('hidden'); app.open(); });
      menu.appendChild(item);
    }
  }

  private toggleStartMenu(): void { document.getElementById('start-menu')!.classList.toggle('hidden'); }
  private hideStartMenu(): void { document.getElementById('start-menu')!.classList.add('hidden'); }

  private startClock(): void {
    const el = document.getElementById('taskbar-clock')!;
    const tick = () => {
      const d = new Date();
      el.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    tick();
    this.clockTimer = setInterval(tick, 1000 * 15);
  }

  private escape(s: string): string {
    const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
  }
}
```

> `applyGeom` 里第一行 `document.querySelector('[data-wm-id]')` 是笔误占位——删掉该行，只保留 `const el = this.rootOf(id)` 分支。（保留此注记以免执行者照抄；正确实现见 `rootOf`。）

- [ ] **步骤 3：创建 `frontend/src/shell/shell-controller.ts`**

```ts
import { WindowManager } from '../wm/window-manager';
import { DesktopShell } from './desktop-shell';
import { MobileShell } from './mobile-shell';
import { detectRuntimeMode, readStoredSelection, writeStoredSelection, resolveMode } from './mode';
import type { Shell, ShellApp, ShellContext, Mode, ModeSelection } from './types';

/** 接管 SP1 Desktop 角色：持有 WM 与当前 Shell，管理模式检测/切换，并提供 ShellContext */
export class ShellController implements ShellContext {
  readonly wm: WindowManager;
  private desktopShell: DesktopShell;
  private mobileShell: MobileShell;
  private shell: Shell;
  private mode: Mode;
  private apps: ShellApp[] = [];
  private modeCbs: Array<(m: Mode) => void> = [];
  private mqls: MediaQueryList[] = [];
  private mqlHandler = () => {
    if (readStoredSelection() === null) this.setMode(detectRuntimeMode());
  };

  constructor() {
    const host = document.getElementById('window-host')!;
    this.wm = new WindowManager(host);
    this.desktopShell = new DesktopShell(host, this.wm);
    this.mobileShell = new MobileShell(host, this.wm, this);
    this.mode = resolveMode(readStoredSelection(), detectRuntimeMode());
    this.shell = this.mode === 'mobile' ? this.mobileShell : this.desktopShell;

    this.wm.onWindowOpened((v) => this.shell.renderWindow(v));
    this.wm.onWindowClosed((id) => this.shell.removeWindow(id));
    this.wm.onChange((views, activeId) => this.shell.syncState(views, activeId));

    this.shell.mount();
    this.watchDeviceChanges();
  }

  show(): void { document.getElementById('desktop')!.classList.remove('hidden'); }
  hide(): void { document.getElementById('desktop')!.classList.add('hidden'); }

  registerApps(apps: ShellApp[]): void {
    this.apps = apps;
    this.shell.renderApps(apps);
  }

  // ---- ShellContext ----
  getMode(): Mode { return this.mode; }
  onModeChange(cb: (m: Mode) => void): () => void {
    this.modeCbs.push(cb);
    return () => { this.modeCbs = this.modeCbs.filter((c) => c !== cb); };
  }

  /** 设置 App 调用：'auto' 清除覆盖并跟随检测，否则写覆盖 */
  applyModeSelection(sel: ModeSelection): void {
    writeStoredSelection(sel);
    this.setMode(sel === 'auto' ? detectRuntimeMode() : sel);
  }

  /** 移动返回键 */
  handleBack(): void {
    const active = this.wm.getActiveId();
    if (!this.wm.handleBack(active) && active) this.wm.minimize(active); // 未消费 → 回主界面
  }

  /** 移动主界面键：隐藏所有窗口回主界面（窗口留后台，仍在切换器） */
  goHome(): void {
    for (const v of this.wm.listViews()) this.wm.minimize(v.id);
  }

  private setMode(next: Mode): void {
    if (next === this.mode) return;
    this.shell.unmount();
    this.mode = next;
    this.shell = next === 'mobile' ? this.mobileShell : this.desktopShell;
    this.shell.mount();
    this.shell.renderApps(this.apps);
    for (const v of this.wm.listViews()) this.shell.renderWindow(v);
    this.shell.syncState(this.wm.listViews(), this.wm.getActiveId());
    this.wm.fireResizeAll();
    this.modeCbs.forEach((cb) => cb(next));
  }

  private watchDeviceChanges(): void {
    this.mqls = [window.matchMedia('(pointer: coarse)'), window.matchMedia('(hover: none)')];
    this.mqls.forEach((m) => m.addEventListener('change', this.mqlHandler));
    window.addEventListener('resize', this.mqlHandler);
  }
}
```

- [ ] **步骤 4：改 `frontend/src/main.ts` 引导装配（1-50 行区域）**

将 `import { Desktop } from './desktop';` 改为 `import { ShellController } from './shell/shell-controller';`，并把 `Desktop` 类型/变量替换为 `ShellController`：

```ts
// 顶部 import 区
import { ShellController } from './shell/shell-controller';
// 删除：import { Desktop } from './desktop';

// 单例
let shell: ShellController | null = null;
function getShell(): ShellController {
  if (!shell) shell = new ShellController();
  return shell;
}
```

把原先所有 `getDesktop()` 调用改为 `getShell()`，`d.wm` 不变（`ShellController.wm` 存在）。`showDesktop` 里 `registerApps` 保持结构，仅通过 `getShell()`（详见任务 D 增加"设置"App）。

> `createTerminalWindow(d.wm, opts)`、`openServersWindow(d.wm, ...)` 中的 `d.wm` 均改为 `getShell().wm`，签名不变。

- [ ] **步骤 5：删除 `frontend/src/desktop.ts`**

```bash
git rm frontend/src/desktop.ts
```
（其 `DesktopApp` 已被 `ShellApp` 取代；`main.ts` 的 App 数组元素结构一致：`{ id, title, icon, open }`。）

- [ ] **步骤 6：占位补全 MobileShell 以通过编译**

此任务需要 `MobileShell` 存在才能编译。先建**最小可编译版** `frontend/src/shell/mobile-shell.ts`（任务 C 填充功能）：

```ts
import type { Shell, ShellApp, WindowView, WindowActions, ShellContext } from './types';

export class MobileShell implements Shell {
  constructor(
    private host: HTMLElement,
    private actions: WindowActions,
    private ctx: ShellContext,
  ) {}
  mount(): void { /* 任务 C 填充 */ }
  unmount(): void { /* 任务 C 填充 */ }
  renderWindow(_view: WindowView): void { /* 任务 C 填充 */ }
  removeWindow(_id: string): void { /* 任务 C 填充 */ }
  syncState(_views: WindowView[], _activeId: string | null): void { /* 任务 C 填充 */ }
  renderApps(_apps: ShellApp[]): void { /* 任务 C 填充 */ }
}
```

> 注：`ShellContext` 参数此处未使用，先加 `// eslint-disable-next-line @typescript-eslint/no-unused-vars` 或在构造里 `void ctx;` 以过 strict/lint。任务 C 会用到。

- [ ] **步骤 7：修正 DesktopShell 的 `applyGeom` 笔误**

删除步骤 2 中 `applyGeom` 里这一行：`const rootEl = document.querySelector<HTMLElement>('[data-wm-id]');`。最终 `applyGeom`：

```ts
private applyGeom(id: string): void {
  const deco = this.decos.get(id); if (!deco) return;
  const el = this.rootOf(id); if (!el) return;
  const g = deco.maximized
    ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight - TASKBAR_H }
    : deco.geom;
  el.style.left = `${g.x}px`; el.style.top = `${g.y}px`;
  el.style.width = `${g.w}px`; el.style.height = `${g.h}px`;
}
```

- [ ] **步骤 8：类型检查**

运行：`npx tsc --noEmit -p frontend/tsconfig.json`
预期：无错误（`MobileShell` 空实现签名与 `Shell` 一致）。

- [ ] **步骤 9：构建 + 桌面回归手测**

运行：`pnpm build:frontend`
预期：构建成功。
手测（桌面/宽屏鼠标环境，`pnpm dev` 后浏览器）：
1. 登录进桌面，桌面图标 + 任务栏 + 开始菜单 + 时钟正常。
2. 打开"服务器"App，连真实 VPS，终端有输出。
3. 窗口拖拽、缩放、最小化、最大化/还原、关闭均正常；任务栏切换正常。
4. 开两台主机终端窗口互不干扰；SFTP 切换、传一个文件成功。
预期：与 SP1 行为一致（无回归）。

- [ ] **步骤 10：Commit**

```bash
git add frontend/src/wm/window-manager.ts frontend/src/shell/ frontend/src/main.ts
git rm frontend/src/desktop.ts
git commit -m "refactor(shell): WindowManager 瘦身为生命周期核心 + DesktopShell/ShellController（桌面行为对齐 SP1）"
```

---

## 任务 C：MobileShell + 运行时切换

填充 `MobileShell`：全屏窗口宿主、主界面图标网格、三键底栏、堆叠切换器、返回分发。完成后移动模式可用，且运行时切换不断会话。

**文件：**
- 修改（整文件替换占位版）：`frontend/src/shell/mobile-shell.ts`

- [ ] **步骤 1：整文件替换 `frontend/src/shell/mobile-shell.ts`**

```ts
import type { Shell, ShellApp, WindowView, WindowActions, ShellContext } from './types';

const BAR_H = 56;   // 三键底栏
const TOP_H = 28;   // 顶部状态条

/** 移动呈现层：单 App 全屏 + 主界面图标网格 + 三键底栏 + 堆叠任务切换器 */
export class MobileShell implements Shell {
  private host: HTMLElement;
  private actions: WindowActions;
  private ctx: ShellContext;          // 预留：供 App 模式感知（本类暂不直接用）
  private apps: ShellApp[] = [];
  private chrome: HTMLElement | null = null;   // 移动 chrome 根（主界面 + 底栏 + 切换器）
  private homeEl!: HTMLElement;
  private switcherEl!: HTMLElement;
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  constructor(host: HTMLElement, actions: WindowActions, ctx: ShellContext) {
    this.host = host; this.actions = actions; this.ctx = ctx; void this.ctx;
  }

  mount(): void {
    this.host.style.top = `${TOP_H}px`;
    this.host.style.bottom = `${BAR_H}px`;
    const desktop = document.getElementById('desktop')!;

    const chrome = document.createElement('div');
    chrome.id = 'mobile-chrome';
    chrome.innerHTML = `
      <div id="m-topbar" style="position:absolute;top:0;left:0;right:0;height:${TOP_H}px;display:flex;align-items:center;justify-content:center;font-size:12px;opacity:.6;z-index:50;"></div>
      <div id="m-home" style="position:absolute;top:${TOP_H}px;left:0;right:0;bottom:${BAR_H}px;z-index:10;
           display:grid;grid-template-columns:repeat(4,1fr);gap:22px 4px;align-content:start;padding:20px 14px;overflow-y:auto;"></div>
      <div id="m-switcher" class="hidden" style="position:absolute;top:${TOP_H}px;left:0;right:0;bottom:${BAR_H}px;z-index:60;
           background:rgba(6,9,14,.92);display:flex;gap:14px;align-items:center;overflow-x:auto;padding:20px;"></div>
      <div id="m-bar" style="position:absolute;left:0;right:0;bottom:0;height:${BAR_H}px;z-index:70;display:flex;
           align-items:center;justify-content:space-around;background:var(--bg-elevated,#0d1017);border-top:1px solid var(--border-strong,#2a2f3a);">
        <button id="m-task"  style="flex:1;height:100%;font-size:18px;">▢</button>
        <button id="m-home-btn" style="flex:1;height:100%;font-size:18px;">○</button>
        <button id="m-back"  style="flex:1;height:100%;font-size:18px;">◁</button>
      </div>`;
    desktop.appendChild(chrome);
    this.chrome = chrome;
    this.homeEl = chrome.querySelector('#m-home') as HTMLElement;
    this.switcherEl = chrome.querySelector('#m-switcher') as HTMLElement;

    (chrome.querySelector('#m-task') as HTMLElement).addEventListener('click', () => this.toggleSwitcher());
    (chrome.querySelector('#m-home-btn') as HTMLElement).addEventListener('click', () => { this.hideSwitcher(); (this.actions as any).__ctrlGoHome?.(); this.goHomeViaMinimize(); });
    (chrome.querySelector('#m-back') as HTMLElement).addEventListener('click', () => this.onBack());

    this.startClock();
    this.renderApps(this.apps);
  }

  unmount(): void {
    if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = null; }
    this.chrome?.remove();
    this.chrome = null;
    // rootEl/bodyEl 归 WM，所有窗口容器保持不动
    this.host.style.top = '';
  }

  renderWindow(view: WindowView): void {
    // 全屏铺满 host（host 已由 mount 设好 top/bottom 边界）
    const el = view.rootEl;
    el.style.left = '0'; el.style.top = '0';
    el.style.width = '100%'; el.style.height = '100%';
    el.style.display = 'none'; // 可见性由 syncState 决定
  }

  removeWindow(_id: string): void { /* 无每窗装饰需清理；容器由 WM 移除 */ }

  syncState(views: WindowView[], activeId: string | null): void {
    // 仅前台窗口可见；无前台则显示主界面
    for (const v of views) {
      v.rootEl.style.display = v.id === activeId ? 'flex' : 'none';
    }
    if (this.homeEl) this.homeEl.style.display = activeId ? 'none' : 'grid';
    if (!this.switcherEl.classList.contains('hidden')) this.renderSwitcher(views, activeId);
  }

  renderApps(apps: ShellApp[]): void {
    this.apps = apps;
    if (!this.homeEl) return;
    this.homeEl.innerHTML = '';
    for (const app of apps) {
      const btn = document.createElement('button');
      btn.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;';
      btn.innerHTML =
        `<span class="material-symbols-outlined" style="font-size:30px;width:52px;height:52px;line-height:52px;border-radius:14px;background:var(--bg-elevated,#0d1017);">${app.icon}</span>` +
        `<span>${this.escape(app.title)}</span>`;
      btn.addEventListener('click', () => app.open()); // 单击即开
      this.homeEl.appendChild(btn);
    }
  }

  // ---- 三键行为 ----
  private onBack(): void {
    if (!this.switcherEl.classList.contains('hidden')) { this.hideSwitcher(); return; }
    // 交给 ShellController 的返回分发（通过 WM 动作扩展，见步骤 2 接线）
    this.backRequest();
  }

  private toggleSwitcher(): void {
    if (this.switcherEl.classList.contains('hidden')) {
      this.switcherEl.classList.remove('hidden');
      this.renderSwitcher(this.currentViews(), this.currentActive());
    } else {
      this.hideSwitcher();
    }
  }
  private hideSwitcher(): void { this.switcherEl.classList.add('hidden'); }

  private renderSwitcher(views: WindowView[], _activeId: string | null): void {
    this.switcherEl.innerHTML = '';
    if (views.length === 0) {
      this.switcherEl.innerHTML = '<div style="margin:auto;opacity:.5;font-size:13px;">无打开的窗口</div>';
      return;
    }
    for (const v of views) {
      const card = document.createElement('div');
      card.style.cssText = 'flex:0 0 auto;width:180px;height:70%;border:1px solid var(--border-strong,#2a2f3a);border-radius:12px;background:var(--bg-surface,#12151c);display:flex;flex-direction:column;overflow:hidden;';
      card.innerHTML =
        `<div style="height:26px;display:flex;align-items:center;gap:6px;padding:0 8px;font-size:11px;background:var(--bg-elevated,#0d1017);">` +
        `<span class="material-symbols-outlined" style="font-size:14px;">${v.icon}</span>` +
        `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escape(v.title)}</span></div>` +
        `<div style="flex:1;display:flex;align-items:center;justify-content:center;opacity:.4;font-size:11px;">${this.escape(v.title)}</div>`;
      // 单击选择
      card.addEventListener('click', () => { this.hideSwitcher(); this.actions.focus(v.id); });
      // 上滑关闭
      this.enableSwipeClose(card, v.id);
      this.switcherEl.appendChild(card);
    }
  }

  private enableSwipeClose(card: HTMLElement, id: string): void {
    let sy = 0, dy = 0, dragging = false;
    card.addEventListener('pointerdown', (e) => { dragging = true; sy = e.clientY; dy = 0; card.setPointerCapture(e.pointerId); });
    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dy = e.clientY - sy;
      if (dy < 0) card.style.transform = `translateY(${dy}px)`;
    });
    card.addEventListener('pointerup', (e) => {
      dragging = false;
      try { card.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (dy < -60) this.actions.close(id);       // 上滑超过阈值 → 关闭
      else card.style.transform = '';
    });
  }

  private startClock(): void {
    const el = this.chrome!.querySelector('#m-topbar') as HTMLElement;
    const tick = () => {
      const d = new Date();
      el.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    tick();
    this.clockTimer = setInterval(tick, 1000 * 15);
  }

  private escape(s: string): string {
    const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
  }

  // ---- 与 ShellController 的桥接（步骤 2 接线注入）----
  currentViews: () => WindowView[] = () => [];
  currentActive: () => string | null = () => null;
  backRequest: () => void = () => {};
  private goHomeViaMinimize(): void { /* 由 controller 注入 goHome，见步骤 2 */ }
}
```

- [ ] **步骤 2：把 MobileShell 与 ShellController 接线**

`MobileShell` 需要三个来自 controller 的能力：读当前窗口/激活态、触发返回分发、回主界面。改 `shell-controller.ts` 构造函数，在 new 之后注入（替代上面临时的 `__ctrlGoHome`/占位）：

```ts
// shell-controller.ts 构造里，new MobileShell 之后：
this.mobileShell.currentViews = () => this.wm.listViews();
this.mobileShell.currentActive = () => this.wm.getActiveId();
this.mobileShell.backRequest = () => this.handleBack();
```

并把 `mobile-shell.ts` 里 `#m-home-btn` 的点击处理简化为（去掉 `__ctrlGoHome` 那段临时代码）：

```ts
(chrome.querySelector('#m-home-btn') as HTMLElement)
  .addEventListener('click', () => { this.hideSwitcher(); this.goHome(); });
```

并把 `MobileShell` 里 `goHomeViaMinimize`/占位替换为一个注入点：

```ts
// 类字段
goHome: () => void = () => {};
// 删除 private goHomeViaMinimize()
```

在 controller 注入：`this.mobileShell.goHome = () => this.goHome();`

- [ ] **步骤 3：类型检查**

运行：`npx tsc --noEmit -p frontend/tsconfig.json`
预期：无错误。修掉任何未用变量/签名问题。

- [ ] **步骤 4：构建**

运行：`pnpm build:frontend`
预期：成功。

- [ ] **步骤 5：移动模式手测**

`pnpm dev` 后用浏览器 DevTools 设备模拟（或窄窗 + 触摸模拟）：
1. 窄屏/触屏加载 → 进移动模式：主界面图标网格（单击"服务器"即开）、底栏三键、无开始菜单。
2. 打开服务器 App → 全屏；连接 → 终端全屏。
3. 任务键 → 切换器出现堆叠卡片；单击卡片切前台；上滑卡片关闭该窗。
4. 主界面键 → 隐藏所有窗口回主界面（切换器里仍在）。
5. 返回键 → 先关切换器/子层，无则回主界面。
预期：全部符合。

- [ ] **步骤 6：运行时切换手测（关键·不断会话）**

在移动模式终端里 `vim x.txt` 进入编辑态 → 缩放浏览器到宽屏（或反向），触发 `matchMedia`/resize 自动切换：
预期：切到桌面模式后**终端窗口仍在、vim 内容与滚动缓冲保留、尺寸自适应**（会话不断）。反向亦然。

- [ ] **步骤 7：Commit**

```bash
git add frontend/src/shell/mobile-shell.ts frontend/src/shell/shell-controller.ts
git commit -m "feat(shell): MobileShell（全屏/三键/堆叠切换器/返回分发）+ 运行时切换不断会话"
```

---

## 任务 D：设置 App（显示模式手动切换）

**文件：**
- 创建：`frontend/src/apps/settings-app.ts`
- 修改：`frontend/src/main.ts`（注册"设置"App）

- [ ] **步骤 1：创建 `frontend/src/apps/settings-app.ts`**

```ts
import type { WindowManager } from '../wm/window-manager';
import type { ShellController } from '../shell/shell-controller';
import { readSelection } from '../shell/mode';
import type { ModeSelection } from '../shell/types';

let settingsWin: { focus: () => void } | null = null;

/** 打开"设置"窗口：显示模式分段开关（自动/桌面/移动）+ SP3 占位 */
export function openSettingsWindow(wm: WindowManager, controller: ShellController): void {
  if (settingsWin) { settingsWin.focus(); return; }

  const win = wm.openWindow({
    title: '设置', icon: 'settings',
    width: 520, height: 420, minWidth: 320, minHeight: 260,
  });
  settingsWin = win;
  win.onClose(() => { settingsWin = null; });

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;overflow-y:auto;padding:20px;';
  wrap.innerHTML = `
    <div style="font-size:12px;opacity:.7;margin-bottom:8px;">显示模式</div>
    <div id="settings-mode" style="display:inline-flex;border:1px solid var(--border-strong,#2a2f3a);border-radius:10px;overflow:hidden;font-size:13px;">
      <button data-mode="auto"    style="padding:8px 18px;">自动</button>
      <button data-mode="desktop" style="padding:8px 18px;border-left:1px solid var(--border-strong,#2a2f3a);">桌面</button>
      <button data-mode="mobile"  style="padding:8px 18px;border-left:1px solid var(--border-strong,#2a2f3a);">移动</button>
    </div>
    <p style="margin-top:12px;font-size:11px;opacity:.6;line-height:1.6;">
      「自动」按设备（触屏/宽度）实时判断；选「桌面/移动」将永久覆盖，直到改回自动。
    </p>
    <div style="margin-top:24px;font-size:12px;opacity:.4;">主题 / 壁纸（后续版本）</div>`;
  win.bodyEl.appendChild(wrap);

  const seg = wrap.querySelector('#settings-mode')!;
  const paint = () => {
    const cur = readSelection();
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      const on = b.dataset['mode'] === cur;
      b.style.background = on ? 'var(--accent,#1b6a3a)' : 'transparent';
      b.style.color = on ? '#fff' : '';
    });
  };
  seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => {
      controller.applyModeSelection(b.dataset['mode'] as ModeSelection);
      paint();
    });
  });
  paint();
}
```

- [ ] **步骤 2：在 `main.ts` 注册"设置"App**

`showDesktop` 里 `registerApps` 增加设置项（`d` = `getShell()`）：

```ts
import { openSettingsWindow } from './apps/settings-app';
// ...
d.registerApps([
  { id: 'servers', title: t('server.list'), icon: 'dns', open: () => openServersWindow(d.wm, user, onLogout) },
  { id: 'settings', title: '设置', icon: 'settings', open: () => openSettingsWindow(d.wm, d) },
]);
```

- [ ] **步骤 3：类型检查 + 构建**

运行：`npx tsc --noEmit -p frontend/tsconfig.json && pnpm build:frontend`
预期：无错误、构建成功。

- [ ] **步骤 4：手测**

1. 桌面/移动模式下均能打开"设置"App。
2. 选「移动」→ 立即切移动外壳；刷新页面仍是移动（localStorage 持久化）。
3. 选「桌面」→ 立即切桌面外壳；刷新仍桌面。
4. 选「自动」→ 清除覆盖，按当前设备判断；分段高亮跟随当前选择。
5. 切换过程中已打开的终端会话不断。

- [ ] **步骤 5：Commit**

```bash
git add frontend/src/apps/settings-app.ts frontend/src/main.ts
git commit -m "feat(app): 设置 App——显示模式手动切换（自动/桌面/移动）+ SP3 占位"
```

**——阶段一完成：双模式外壳框架可用且可交付——**

---

## 任务 E：终端软键盘辅助条（阶段二）

**文件：**
- 创建：`frontend/src/mobile/soft-key-bar.ts`
- 修改：`frontend/src/apps/terminal-app.ts`（onBack + 移动挂辅助条）
- 修改：`frontend/src/apps/servers-app.ts`（onBack 关 modal）
- 修改：`frontend/src/main.ts`（把 `ShellContext` 传给终端 App）

- [ ] **步骤 1：创建 `frontend/src/mobile/soft-key-bar.ts`**

```ts
import type { SSHTerminal } from '../terminal';

// 控制序列
const SEQ: Record<string, string> = {
  Esc: '\x1b', Tab: '\t',
  Up: '\x1b[A', Down: '\x1b[B', Right: '\x1b[C', Left: '\x1b[D',
  Home: '\x1b[H', End: '\x1b[F', PgUp: '\x1b[5~', PgDn: '\x1b[6~',
};
const PRIMARY: Array<[string, string]> = [
  ['Esc', 'Esc'], ['Ctrl', 'Ctrl'], ['Alt', 'Alt'], ['Tab', 'Tab'],
  ['↑', 'Up'], ['↓', 'Down'], ['←', 'Left'], ['→', 'Right'],
];
const EXTRA: Array<[string, string]> = [
  ['|', '|'], ['~', '~'], ['/', '/'], ['-', '-'],
  ['PgUp', 'PgUp'], ['PgDn', 'PgDn'], ['Home', 'Home'], ['End', 'End'], ['^C', 'CtrlC'],
];

/** 终端软键盘辅助条：吸附终端底部，发送控制序列。返回 { el, dispose } */
export function createSoftKeyBar(terminal: SSHTerminal): { el: HTMLElement; dispose: () => void } {
  let ctrl = false, alt = false, expanded = false;
  const bar = document.createElement('div');
  bar.className = 'soft-key-bar';
  bar.style.cssText =
    'position:absolute;left:0;right:0;bottom:0;z-index:20;display:flex;gap:4px;overflow-x:auto;' +
    'padding:5px 4px;background:var(--bg-elevated,#0d1017);border-top:1px solid var(--border-strong,#2a2f3a);';

  const send = (data: string) => terminal.sendWebSocketMessage(data);

  const press = (code: string) => {
    // 修饰键：粘滞
    if (code === 'Ctrl') { ctrl = !ctrl; render(); return; }
    if (code === 'Alt') { alt = !alt; render(); return; }
    if (code === 'CtrlC') { send('\x03'); return; }

    let base = SEQ[code];
    if (base === undefined) {
      // 字面字符（| ~ / - 等，code 即字符）
      base = code;
    }
    if (ctrl && base.length === 1) {
      const c = base.toUpperCase().charCodeAt(0);
      if (c >= 64 && c <= 95) base = String.fromCharCode(c - 64); // Ctrl+A.._
    }
    if (alt) base = '\x1b' + base;
    send(base);
    ctrl = false; alt = false; render();
  };

  const mkBtn = (label: string, code: string) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset['code'] = code;
    b.style.cssText = 'flex:0 0 auto;border:1px solid var(--border-strong,#2a2f3a);border-radius:6px;padding:4px 9px;font-size:12px;background:transparent;';
    b.addEventListener('click', () => press(code));
    return b;
  };

  const render = () => {
    bar.innerHTML = '';
    for (const [label, code] of PRIMARY) bar.appendChild(mkBtn(label, code));
    const more = mkBtn(expanded ? '×' : '…', '__toggle');
    more.addEventListener('click', (e) => { e.stopPropagation(); expanded = !expanded; render(); });
    bar.appendChild(more);
    if (expanded) for (const [label, code] of EXTRA) bar.appendChild(mkBtn(label, code));
    // 修饰键高亮
    bar.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      const on = (b.dataset['code'] === 'Ctrl' && ctrl) || (b.dataset['code'] === 'Alt' && alt);
      b.style.background = on ? 'var(--accent,#1b6a3a)' : 'transparent';
      b.style.color = on ? '#fff' : '';
    });
  };
  render();

  return { el: bar, dispose: () => bar.remove() };
}
```

> `mkBtn('…', '__toggle')` 的 `press('__toggle')` 会走"字面字符"分支并 `send('__toggle')`——因此 more 按钮**额外**绑定了 `stopPropagation` 的自身 handler 并未阻止 `mkBtn` 内的 `press`。修正：`mkBtn` 对 `code==='__toggle'` 不绑定 `press`。见步骤 2。

- [ ] **步骤 2：修正 more 按钮不触发 send**

把 `mkBtn` 改为：`code==='__toggle'` 时不绑定 `press`：

```ts
const mkBtn = (label: string, code: string) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset['code'] = code;
  b.style.cssText = 'flex:0 0 auto;border:1px solid var(--border-strong,#2a2f3a);border-radius:6px;padding:4px 9px;font-size:12px;background:transparent;';
  if (code !== '__toggle') b.addEventListener('click', () => press(code));
  return b;
};
```

- [ ] **步骤 3：终端 App 接入辅助条 + onBack**

改 `frontend/src/apps/terminal-app.ts`：`createTerminalWindow` 增加 `ctx?: ShellContext` 参数（可选，向后兼容匿名路径），并：

```ts
import type { ShellContext } from '../shell/types';
import { createSoftKeyBar } from '../mobile/soft-key-bar';

export function createTerminalWindow(
  wm: WindowManager,
  opts: CreateTerminalWindowOptions,
  ctx?: ShellContext,
): { terminal: SSHTerminal; win: WindowHandle } {
  // ... 现有装配到 terminal.mount() 之前保持不变 ...

  // 软键盘辅助条：仅移动模式挂载，随模式变化增删
  let keyBar: { el: HTMLElement; dispose: () => void } | null = null;
  const mountKeyBar = () => {
    if (keyBar) return;
    keyBar = createSoftKeyBar(terminal);
    win.bodyEl.appendChild(keyBar.el);
    terminal.fit();
  };
  const unmountKeyBar = () => { keyBar?.dispose(); keyBar = null; terminal.fit(); };
  const syncKeyBar = (mode: 'desktop' | 'mobile') => (mode === 'mobile' ? mountKeyBar() : unmountKeyBar());
  let offMode: (() => void) | null = null;
  if (ctx) { syncKeyBar(ctx.getMode()); offMode = ctx.onModeChange(syncKeyBar); }

  // onBack：SFTP 面板开→切回终端；软键盘辅助条不拦截（系统软键盘由输入焦点控制）
  win.onBack(() => {
    if (sftp?.isVisible()) { sftp.hide(); return true; }
    return false;
  });

  // 关窗清理里追加：
  win.onClose(() => {
    offMode?.();
    keyBar?.dispose();
    sftp?.dispose();
    sftp = null;
    terminal.disconnect();
    terminal.dispose();
  });

  terminal.mount();
  return { terminal, win };
}
```

> `openTerminalFromWsUrl` 增加透传 `ctx?`：`createTerminalWindow(wm, {...}, ctx)`；其签名加 `ctx?: ShellContext` 参数。

- [ ] **步骤 4：服务器 App 的 onBack（关 modal）**

改 `frontend/src/apps/servers-app.ts`，在 `win` 创建后加：

```ts
win.onBack(() => {
  const modal = document.getElementById('server-modal');
  if (modal && !modal.classList.contains('hidden')) {
    (document.getElementById('modal-close-btn') as HTMLElement | null)?.click();
    return true;
  }
  return false;
});
```

并把 `openServersWindow` 里的 `openTerminalFromWsUrl(wm, {...})` 透传 `ctx`（新增 `ctx?: ShellContext` 参数），或由 `main.ts` 统一注入（见步骤 5）。

- [ ] **步骤 5：main.ts 透传 ShellContext**

`ShellController` 即 `ShellContext`（实现了 `getMode/onModeChange`）。在 `main.ts` 里把 `getShell()` 作为 ctx 传入终端/服务器 App：

```ts
// servers-app.open：
{ id: 'servers', title: t('server.list'), icon: 'dns',
  open: () => openServersWindow(d.wm, user, onLogout, d) },
// 匿名连接：createTerminalWindowOnDesktop 内
return createTerminalWindow(d.wm, opts, d);
```

对应给 `openServersWindow` 增加 `ctx: ShellContext` 形参并透传给 `openTerminalFromWsUrl`。

- [ ] **步骤 6：类型检查 + 构建**

运行：`npx tsc --noEmit -p frontend/tsconfig.json && pnpm build:frontend`
预期：无错误、构建成功。

- [ ] **步骤 7：手测**

1. 移动模式终端底部出现辅助条；桌面模式无。
2. `Esc`/方向键在 `vim` 生效；`Ctrl` 点亮后按 `C`（需另配字符键或用 `^C`）——用 `^C` 直接发 Ctrl+C 中断 `ping`。
3. `…` 展开出现 `| ~ / -`/PgUp 等；点击发送正确字符。
4. 运行时从桌面切移动，辅助条即时出现并 `fit()`；切回消失。
5. `onBack`：终端里 SFTP 面板打开时按返回键 → 关面板回终端；服务器 modal 打开时按返回 → 关 modal。

- [ ] **步骤 8：Commit**

```bash
git add frontend/src/mobile/soft-key-bar.ts frontend/src/apps/terminal-app.ts frontend/src/apps/servers-app.ts frontend/src/main.ts
git commit -m "feat(mobile): 终端软键盘辅助条 + 上下文感知返回（终端/服务器 onBack）"
```

---

## 任务 F：触屏可用化打磨（阶段二）

让连接表单、服务器列表、终端在触屏全屏下好用。以 CSS/属性微调为主，**不改业务逻辑**。

**文件：**
- 修改：`frontend/index.html`（连接表单/服务器列表已用 Tailwind 响应式类，补触屏点击目标与滚动）
- 修改：`frontend/src/style.css`（若存在；否则内联）——增最小触屏样式

- [ ] **步骤 1：审查现状**

运行：在移动模拟下逐一打开 匿名连接表单（`#auth-section`）、服务器 App（`#server-space-host` 卡片网格 `grid-cols-1 md:grid-cols-2`）、服务器 modal（`#server-modal`），记录挤压/溢出/点击目标过小处。

- [ ] **步骤 2：补触屏样式（`frontend/src/style.css` 末尾追加）**

```css
/* 移动外壳下的触屏可用性微调 */
#mobile-chrome #m-bar button { -webkit-tap-highlight-color: transparent; }
.soft-key-bar button { min-width: 36px; min-height: 30px; }
/* 服务器 modal 在窄屏可滚动、留安全边距 */
@media (pointer: coarse) {
  #server-modal .cyber-box { max-height: 88vh; overflow-y: auto; }
  #server-space-host header { padding-left: 12px; padding-right: 12px; }
}
```

> 若项目无 `frontend/src/style.css`（`index.html` 用 CDN Tailwind），改为在 `index.html` 的 `<style>` 块追加同等规则。步骤 1 先确认样式文件位置。

- [ ] **步骤 3：服务器卡片网格移动单列**

确认 `#server-grid` 已是 `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`（窄屏天然单列），无需改。若卡片内按钮点击目标 < 40px，补 `py-2` 类。仅在实测不足时改，避免无谓改动。

- [ ] **步骤 4：类型检查 + 构建**

运行：`npx tsc --noEmit -p frontend/tsconfig.json && pnpm build:frontend`
预期：成功。

- [ ] **步骤 5：手测（真机或模拟触屏）**

1. 匿名连接表单：字段、按钮在窄屏不溢出、可点。
2. 服务器 App：卡片单列、可滚动；添加/编辑 modal 可滚动、可提交。
3. 终端：全屏可读；辅助条 + 系统软键盘并存时输入区可见（若被遮挡，记录为后续 `visualViewport` 优化，不在本任务扩范围）。

- [ ] **步骤 6：Commit**

```bash
git add frontend/src/style.css frontend/index.html
git commit -m "style(mobile): 连接表单/服务器列表/终端触屏可用性微调"
```

**——阶段二完成：移动端触屏可用——**

---

## 自检结果

**1. 规格覆盖度**（对照规格章节）：
- §2.1.1 双模式检测/切换 → 任务 A（mode.ts）+ 任务 C/D（切换）✅
- §2.1.2 移动外壳（图标网格/三键/切换器）→ 任务 C ✅
- §2.1.3 桌面回归 → 任务 B 步骤 9 ✅
- §2.1.4 运行时切换不断会话 → 任务 C 步骤 6 ✅
- §2.1.5 触屏可用 + 软键盘辅助条 → 任务 E/F ✅
- §2.1.6 设置 App → 任务 D ✅
- §2.1.7 返回分发 → 任务 A（dispatchBack）+ C（三键）+ E（onBack 注册）✅
- §4.4 软键盘按键集/粘滞修饰 → 任务 E（SEQ/PRIMARY/EXTRA，Ctrl/Alt 粘滞）✅
- §5.2 硬约束（bodyEl 不销毁）→ 任务 B/C：Shell 只增删装饰/改 rootEl 样式，WM 拥有 rootEl+bodyEl ✅
- §8 单测（mode/back-dispatch）→ 任务 A ✅

**2. 占位符扫描**：计划中 DesktopShell `applyGeom` 的笔误行与 soft-key-bar `__toggle` 均以"步骤级修正"显式给出正确代码，非遗留 TODO；MobileShell 在任务 B 步骤 6 为"最小可编译占位"，任务 C 步骤 1 整文件替换填充——已明确。无"待补充"式占位。

**3. 类型一致性**：`Mode`/`ShellApp`/`WindowView`/`WindowActions`/`Shell`/`ShellContext`/`ModeSelection` 全部在任务 A 的 `types.ts` 定义，后续任务一致引用；`WindowManager implements WindowActions`（focus/minimize/close/fireResize 签名一致）；`ShellController implements ShellContext`（getMode/onModeChange）；`MobileShell` 注入桥接字段（currentViews/currentActive/backRequest/goHome）在任务 C 步骤 2 与 controller 对齐。

---

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-07-23-webssh-mobile-shell.md`。两种执行方式：

1. **子代理驱动（推荐）** — 每个任务调度一个新子代理，任务间两阶段审查，快速迭代。
2. **内联执行** — 当前会话用 executing-plans 批量执行并设检查点。

选哪种方式？
