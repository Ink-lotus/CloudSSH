# Web SSH 类 Windows 桌面（SP1：地基 + 桌面外壳骨架）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。
>
> **提交约定：** 本仓库用户要求“不主动 commit，除非明确要求”。计划中的 `git commit` 步骤是 TDD 建议节奏；执行时请按用户当次意愿决定是立即提交还是批量提交后统一确认。

**目标：** 把 fork 自 CloudSSH 的纯前端标签页界面，改造成 GMSSH 式类 Windows 桌面：窗口管理器 + 桌面外壳（壁纸/图标/任务栏/开始菜单），复用其现成 `SSHTerminal`/`SFTPPanel`/`ServerList` 连接真实 VPS。

**架构：** 后端引擎（`src/worker/**`、`src/ssh/**`、Durable Objects、`/api/*` 与 WS 接口）原样不动。前端用新的 `WindowManager` 替换 `TabManager`，用 `Desktop` 外壳替换三页面 show/hide；每个 SSH 会话变成桌面上一个可拖拽/缩放/最小化的终端窗口。窗口的可测逻辑抽为纯函数用 Vitest 单测；DOM 交互靠 `wrangler dev` / 部署后手测。

**技术栈：** pnpm workspace + Vite + TypeScript + Tailwind（CDN）+ xterm v6；Cloudflare Workers + SQLite Durable Objects + `cloudflare:sockets`；Vitest（已在根 `package.json`）。

---

## 文件结构

**归档（移入 `legacy/`）**
- `index.html`、`src/app.js`、`src/data.js`、`styles.css`、`server.mjs`、`tests/` — 现有 Atlas 原型，仅留存不再使用。
- `README.md` — 旧原型说明，改写为新项目说明（见任务 7）。

**引入（来自 CloudSSH，作为新基座，保持路径）**
- `frontend/**`、`src/worker/**`、`src/ssh/**`、`scripts/build-html.js`、`wrangler.toml`、`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.json`、`LICENSE`、`NOTICE`（若有）。

**新增（前端）**
- `frontend/src/wm/window-logic.ts` — 窗口纯逻辑（位置钳制、z 序、任务栏派生），无 DOM，可单测。
- `frontend/src/wm/window-logic.test.ts` — 上述单测。
- `frontend/src/wm/window-manager.ts` — `WindowManager` + `WindowHandle`：窗口边框、拖拽、缩放、最小/最大化、z 序、关闭、变更事件。对业务零认知。
- `frontend/src/desktop.ts` — 桌面外壳：壁纸、桌面图标层、任务栏、开始菜单、时钟；订阅 `WindowManager` 变更渲染任务栏。
- `frontend/src/apps/terminal-app.ts` — `openTerminalWindow()`：取 wsUrl → 开窗 → 挂 `SSHTerminal` → 绑定 resize/SFTP/清理。
- `frontend/src/apps/servers-app.ts` — `openServersWindow()`：窗口内嵌 `ServerList`，转发连接。

**改造（前端）**
- `frontend/index.html` — 三段式 body → 登录门 `#auth-section` + 桌面根 `#desktop`；保留服务器增改 modal。
- `frontend/src/main.ts` — 三页面引导 → 桌面引导。
- `frontend/src/auth-form.ts` — 连接回调由“创建 tab”改为调用 `openTerminalWindow`（任务 6 内定位并改）。

---

## 任务 1：Fork 落地与基线验证

**目标：** 用 CloudSSH 覆盖本仓库为新基座，Atlas 归档，确认能构建、能部署、能连真实 VPS（改造前的绿色基线）。

**文件：**
- 移动：Atlas 原型文件 → `legacy/`
- 引入：CloudSSH 全量源码到仓库根

- [ ] **步骤 1：归档 Atlas 原型**

```bash
cd /d/tool/Claude/ssh
mkdir -p legacy
git mv index.html legacy/ 2>/dev/null || mv index.html legacy/
git mv styles.css legacy/ 2>/dev/null || mv styles.css legacy/
git mv server.mjs legacy/ 2>/dev/null || mv server.mjs legacy/
git mv package.json legacy/atlas-package.json 2>/dev/null || mv package.json legacy/atlas-package.json
git mv src legacy/src 2>/dev/null || mv src legacy/src
git mv tests legacy/tests 2>/dev/null || mv tests legacy/tests
```

- [ ] **步骤 2：拉取 CloudSSH 到临时目录并复制入库（保留本仓库 .git）**

```bash
cd /tmp
rm -rf cloudssh-src
git clone --depth 1 https://github.com/newbietan/CloudSSH.git cloudssh-src
# 复制除 .git 外的全部内容到仓库根
cd cloudssh-src
cp -r --parents $(git ls-files) /d/tool/Claude/ssh/
# 关键根文件确认（若上一步遗漏，手动补齐）
cp wrangler.toml package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json LICENSE /d/tool/Claude/ssh/ 2>/dev/null || true
```

预期：`/d/tool/Claude/ssh` 下出现 `frontend/`、`src/worker/`、`src/ssh/`、`wrangler.toml`、`package.json` 等，且 `legacy/` 保留旧原型。

- [ ] **步骤 3：安装依赖并类型/构建验证**

```bash
cd /d/tool/Claude/ssh
pnpm install
pnpm --filter cloudssh-frontend build   # tsc && vite build，验证类型
node scripts/build-html.js               # 验证前端产物注入 worker 的管线
```

预期：`tsc` 无错误，`vite build` 产出 `frontend/dist`，`build-html.js` 成功生成 worker 内联 HTML。

- [ ] **步骤 4：配置部署前置项（一次性）**

在 Cloudflare Dashboard 为该 Worker 配置环境变量（`wrangler.toml` 注释已列）：
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`（GitHub OAuth App，回调 `<BASE_URL>/api/auth/github/callback`）
- `BASE_URL`（部署域名，与 OAuth 回调一致）
- 可选：`TURNSTILE_SECRET` / `TURNSTILE_SITEKEY`

- [ ] **步骤 5：部署基线并冒烟**

```bash
cd /d/tool/Claude/ssh
pnpm deploy        # node scripts/build-html.js && wrangler deploy（首次会创建两个 DO）
```

预期：部署成功；打开分配的 `*.workers.dev` 域名 → GitHub 登录 → 添加一台真实 VPS → 连接 → 原版标签页终端能执行 `ls`。**这一步确认引擎在你账号上真实可用，是后续改造的绿色基线。**

- [ ] **步骤 6：Commit**

```bash
git add -A
git commit -m "chore: fork CloudSSH 作为基座，归档 Atlas 原型到 legacy/"
```

---

## 任务 2：窗口纯逻辑 `window-logic.ts`（TDD）

**文件：**
- 创建：`frontend/src/wm/window-logic.ts`
- 测试：`frontend/src/wm/window-logic.test.ts`

- [ ] **步骤 1：编写失败的测试**

`frontend/src/wm/window-logic.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { clampPosition, topZIndex, deriveTaskbar } from './window-logic';

describe('clampPosition', () => {
  it('右下越界被钳制到可视范围', () => {
    // 视口 1000x800，任务栏 48 → 可用高 752；窗口 400x300 → maxX=600, maxY=452
    expect(clampPosition(2000, 2000, 400, 300, 1000, 800, 48)).toEqual({ x: 600, y: 452 });
  });
  it('负坐标钳制到 0', () => {
    expect(clampPosition(-50, -20, 400, 300, 1000, 800, 48)).toEqual({ x: 0, y: 0 });
  });
  it('窗口比视口大时回到原点', () => {
    expect(clampPosition(100, 100, 2000, 2000, 1000, 800, 48)).toEqual({ x: 0, y: 0 });
  });
});

describe('topZIndex', () => {
  it('空集合返回 base', () => {
    expect(topZIndex([], 100)).toBe(100);
  });
  it('返回当前最大值 +1', () => {
    expect(topZIndex([100, 103, 101], 100)).toBe(104);
  });
});

describe('deriveTaskbar', () => {
  it('按打开顺序映射窗口元数据', () => {
    const items = deriveTaskbar([
      { id: 'a', title: 'A', icon: 'terminal', active: false, minimized: false },
      { id: 'b', title: 'B', icon: 'folder', active: true, minimized: true },
    ]);
    expect(items).toEqual([
      { id: 'a', title: 'A', icon: 'terminal', active: false, minimized: false },
      { id: 'b', title: 'B', icon: 'folder', active: true, minimized: true },
    ]);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm test -- window-logic`
预期：FAIL，报错找不到模块 `./window-logic` 或导出未定义。

- [ ] **步骤 3：编写最少实现**

`frontend/src/wm/window-logic.ts`：

```ts
// 窗口纯逻辑：不依赖 DOM，便于单元测试

/** 将窗口左上角坐标钳制在视口内，底部预留任务栏高度，保证整窗可见 */
export function clampPosition(
  x: number, y: number, width: number, height: number,
  viewportWidth: number, viewportHeight: number, taskbarHeight = 48,
): { x: number; y: number } {
  const maxX = Math.max(0, viewportWidth - width);
  const maxY = Math.max(0, (viewportHeight - taskbarHeight) - height);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  };
}

/** 聚焦某窗口时应使用的新 z-index（当前最大值 +1；空集合用 base） */
export function topZIndex(zIndexes: number[], base = 100): number {
  if (zIndexes.length === 0) return base;
  return Math.max(...zIndexes) + 1;
}

export interface WindowMeta {
  id: string; title: string; icon: string; active: boolean; minimized: boolean;
}
export type TaskbarItem = WindowMeta;

/** 由窗口集合派生任务栏项（保持传入顺序） */
export function deriveTaskbar(windows: WindowMeta[]): TaskbarItem[] {
  return windows.map((w) => ({
    id: w.id, title: w.title, icon: w.icon, active: w.active, minimized: w.minimized,
  }));
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm test -- window-logic`
预期：PASS（3 个 describe 全绿）。

- [ ] **步骤 5：Commit**

```bash
git add frontend/src/wm/window-logic.ts frontend/src/wm/window-logic.test.ts
git commit -m "feat(wm): 窗口纯逻辑（位置钳制/z序/任务栏派生）+ 单测"
```

---

## 任务 3：窗口管理器 `window-manager.ts`

**目标：** 提供 `WindowManager.openWindow()` 返回 `WindowHandle`，实现窗口边框、拖拽、缩放、最小/最大化、点击置顶、关闭，并在窗口集合变化时通过 `onChange` 广播任务栏项。DOM 交互靠手测；逻辑已由任务 2 覆盖。

**文件：**
- 创建：`frontend/src/wm/window-manager.ts`

- [ ] **步骤 1：编写实现**

`frontend/src/wm/window-manager.ts`：

```ts
import { clampPosition, topZIndex, deriveTaskbar, TaskbarItem } from './window-logic';

export interface OpenWindowOptions {
  title: string;
  icon: string;              // Material Symbols 图标名
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  x?: number;
  y?: number;
}

export interface WindowHandle {
  readonly id: string;
  readonly bodyEl: HTMLElement;      // 内容挂载点
  focus(): void;
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  setTitle(title: string): void;
  setDisconnected(disconnected: boolean): void;
  onResize(cb: () => void): void;    // 窗口尺寸变化（缩放/最大化/还原）
  onClose(cb: () => void): void;
}

interface WinRecord {
  id: string;
  opts: OpenWindowOptions;
  rootEl: HTMLDivElement;
  bodyEl: HTMLElement;
  titleEl: HTMLElement;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  prevRect?: { x: number; y: number; width: number; height: number };
  resizeCbs: Array<() => void>;
  closeCbs: Array<() => void>;
}

const BASE_Z = 100;

export class WindowManager {
  private host: HTMLElement;
  private wins = new Map<string, WinRecord>();
  private activeId: string | null = null;
  private counter = 0;
  private changeCbs: Array<(items: TaskbarItem[]) => void> = [];

  constructor(host: HTMLElement) {
    this.host = host;
  }

  /** 订阅窗口集合/状态变化（供任务栏渲染） */
  onChange(cb: (items: TaskbarItem[]) => void): void {
    this.changeCbs.push(cb);
  }

  private emitChange(): void {
    const items = deriveTaskbar(
      Array.from(this.wins.values()).map((w) => ({
        id: w.id, title: w.opts.title, icon: w.opts.icon,
        active: w.id === this.activeId, minimized: w.minimized,
      })),
    );
    this.changeCbs.forEach((cb) => cb(items));
  }

  openWindow(opts: OpenWindowOptions): WindowHandle {
    const id = `win-${++this.counter}`;
    const width = opts.width ?? 720;
    const height = opts.height ?? 460;
    // 级联初始位置
    const offset = (this.wins.size % 6) * 28;
    const start = clampPosition(
      opts.x ?? 80 + offset, opts.y ?? 60 + offset,
      width, height, window.innerWidth, window.innerHeight,
    );

    const rootEl = document.createElement('div');
    rootEl.className = 'wm-window';
    rootEl.style.cssText =
      `position:absolute;left:${start.x}px;top:${start.y}px;width:${width}px;height:${height}px;` +
      `min-width:${opts.minWidth ?? 320}px;min-height:${opts.minHeight ?? 200}px;` +
      `display:flex;flex-direction:column;background:var(--bg-surface,#12151c);` +
      `border:1px solid var(--border-strong,#2a2f3a);box-shadow:0 12px 40px rgba(0,0,0,.5);overflow:hidden;`;

    rootEl.innerHTML = `
      <div class="wm-titlebar" style="height:34px;flex:0 0 auto;display:flex;align-items:center;gap:8px;
           padding:0 8px;background:var(--bg-elevated,#0d1017);cursor:move;user-select:none;">
        <span class="material-symbols-outlined" style="font-size:16px;opacity:.8;">${opts.icon}</span>
        <span class="wm-title" style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escape(opts.title)}</span>
        <button class="wm-min"  title="最小化" style="width:26px;height:24px;">&#8211;</button>
        <button class="wm-max"  title="最大化" style="width:26px;height:24px;">&#9633;</button>
        <button class="wm-close" title="关闭" style="width:26px;height:24px;">&#10005;</button>
      </div>
      <div class="wm-body" style="flex:1;min-height:0;position:relative;overflow:hidden;"></div>
      <div class="wm-resize" style="position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;"></div>
    `;
    this.host.appendChild(rootEl);

    const rec: WinRecord = {
      id, opts, rootEl,
      bodyEl: rootEl.querySelector('.wm-body') as HTMLElement,
      titleEl: rootEl.querySelector('.wm-title') as HTMLElement,
      zIndex: BASE_Z, minimized: false, maximized: false,
      resizeCbs: [], closeCbs: [],
    };
    this.wins.set(id, rec);

    // 聚焦
    rootEl.addEventListener('pointerdown', () => this.focus(id));
    (rootEl.querySelector('.wm-min') as HTMLElement).addEventListener('click', (e) => { e.stopPropagation(); this.minimize(id); });
    (rootEl.querySelector('.wm-max') as HTMLElement).addEventListener('click', (e) => { e.stopPropagation(); this.toggleMaximize(id); });
    (rootEl.querySelector('.wm-close') as HTMLElement).addEventListener('click', (e) => { e.stopPropagation(); this.close(id); });

    this.enableDrag(rec, rootEl.querySelector('.wm-titlebar') as HTMLElement);
    this.enableResize(rec, rootEl.querySelector('.wm-resize') as HTMLElement);

    this.focus(id);
    this.emitChange();
    return this.makeHandle(rec);
  }

  focus(id: string): void {
    const rec = this.wins.get(id);
    if (!rec) return;
    if (rec.minimized) { rec.minimized = false; rec.rootEl.style.display = 'flex'; }
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
    rec.rootEl.style.display = 'none';
    if (this.activeId === id) this.activeId = null;
    this.emitChange();
  }

  toggleMaximize(id: string): void {
    const rec = this.wins.get(id);
    if (!rec) return;
    if (!rec.maximized) {
      rec.prevRect = {
        x: rec.rootEl.offsetLeft, y: rec.rootEl.offsetTop,
        width: rec.rootEl.offsetWidth, height: rec.rootEl.offsetHeight,
      };
      rec.rootEl.style.left = '0'; rec.rootEl.style.top = '0';
      rec.rootEl.style.width = '100%';
      rec.rootEl.style.height = `calc(100% - 48px)`; // 预留任务栏
      rec.maximized = true;
    } else if (rec.prevRect) {
      rec.rootEl.style.left = `${rec.prevRect.x}px`;
      rec.rootEl.style.top = `${rec.prevRect.y}px`;
      rec.rootEl.style.width = `${rec.prevRect.width}px`;
      rec.rootEl.style.height = `${rec.prevRect.height}px`;
      rec.maximized = false;
    }
    this.fireResize(rec);
  }

  close(id: string): void {
    const rec = this.wins.get(id);
    if (!rec) return;
    rec.closeCbs.forEach((cb) => cb());
    rec.rootEl.remove();
    this.wins.delete(id);
    if (this.activeId === id) this.activeId = null;
    this.emitChange();
  }

  private enableDrag(rec: WinRecord, handle: HTMLElement): void {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      if (rec.maximized) return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      ox = rec.rootEl.offsetLeft; oy = rec.rootEl.offsetTop;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const p = clampPosition(
        ox + (e.clientX - sx), oy + (e.clientY - sy),
        rec.rootEl.offsetWidth, rec.rootEl.offsetHeight,
        window.innerWidth, window.innerHeight,
      );
      rec.rootEl.style.left = `${p.x}px`;
      rec.rootEl.style.top = `${p.y}px`;
    });
    handle.addEventListener('pointerup', (e) => {
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    });
  }

  private enableResize(rec: WinRecord, handle: HTMLElement): void {
    let sx = 0, sy = 0, ow = 0, oh = 0, resizing = false;
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); resizing = true;
      sx = e.clientX; sy = e.clientY;
      ow = rec.rootEl.offsetWidth; oh = rec.rootEl.offsetHeight;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      const minW = rec.opts.minWidth ?? 320;
      const minH = rec.opts.minHeight ?? 200;
      rec.rootEl.style.width = `${Math.max(minW, ow + (e.clientX - sx))}px`;
      rec.rootEl.style.height = `${Math.max(minH, oh + (e.clientY - sy))}px`;
      this.fireResize(rec);
    });
    handle.addEventListener('pointerup', (e) => {
      resizing = false;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      this.fireResize(rec);
    });
  }

  private fireResize(rec: WinRecord): void {
    rec.resizeCbs.forEach((cb) => cb());
  }

  private makeHandle(rec: WinRecord): WindowHandle {
    return {
      id: rec.id,
      bodyEl: rec.bodyEl,
      focus: () => this.focus(rec.id),
      minimize: () => this.minimize(rec.id),
      toggleMaximize: () => this.toggleMaximize(rec.id),
      close: () => this.close(rec.id),
      setTitle: (t: string) => { rec.opts.title = t; rec.titleEl.textContent = t; this.emitChange(); },
      setDisconnected: (d: boolean) => { rec.rootEl.classList.toggle('wm-disconnected', d); },
      onResize: (cb: () => void) => { rec.resizeCbs.push(cb); },
      onClose: (cb: () => void) => { rec.closeCbs.push(cb); },
    };
  }

  private escape(s: string): string {
    const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
  }
}
```

- [ ] **步骤 2：类型验证**

运行：`pnpm --filter cloudssh-frontend exec tsc --noEmit`
预期：无类型错误（`window-manager.ts` 正确引用 `window-logic.ts` 的导出）。

- [ ] **步骤 3：Commit**

```bash
git add frontend/src/wm/window-manager.ts
git commit -m "feat(wm): 窗口管理器（拖拽/缩放/最小最大化/z序/变更事件）"
```

---

## 任务 4：桌面外壳 `desktop.ts` 与 `index.html` 改造

**目标：** 登录后进入空桌面：壁纸、桌面图标、任务栏（订阅 `WindowManager.onChange`）、开始菜单、时钟。桌面图标/开始菜单能触发“打开某 App”回调（App 装配在任务 5/6 接入）。

**文件：**
- 创建：`frontend/src/desktop.ts`
- 修改：`frontend/index.html`

- [ ] **步骤 1：改造 `index.html`**

将 `<body>` 内 `#user-space-section` 与 `#terminal-section` 两段替换为单一桌面根节点（保留 `#auth-section` 登录门与 `#server-modal`）：

```html
<!-- 桌面（登录后） -->
<div id="desktop" class="hidden fixed inset-0 overflow-hidden">
  <div id="desktop-wallpaper" class="absolute inset-0"
       style="background:radial-gradient(circle at 30% 20%, #1b2130, #0a0d14);"></div>
  <div id="desktop-icons" class="absolute inset-0 p-4 flex flex-col flex-wrap gap-2 content-start"></div>
  <div id="window-host" class="absolute inset-0" style="bottom:48px;"></div>
  <div id="taskbar" class="absolute left-0 right-0 bottom-0 h-12 flex items-center gap-1 px-2 z-[9999]"
       style="background:var(--bg-elevated,#0d1017);border-top:1px solid var(--border-strong,#2a2f3a);">
    <button id="start-btn" class="px-3 h-9 flex items-center gap-2 text-sm">
      <span class="material-symbols-outlined" style="font-size:18px;">apps</span>开始
    </button>
    <div id="taskbar-items" class="flex-1 flex items-center gap-1 overflow-x-auto"></div>
    <div id="taskbar-clock" class="px-3 text-xs opacity-80"></div>
  </div>
  <div id="start-menu" class="hidden absolute bottom-12 left-2 w-64 z-[9999] p-2"
       style="background:var(--bg-surface,#12151c);border:1px solid var(--border-strong,#2a2f3a);"></div>
</div>
```

- [ ] **步骤 2：编写 `desktop.ts`**

```ts
import { WindowManager } from './wm/window-manager';
import type { TaskbarItem } from './wm/window-logic';

export interface DesktopApp {
  id: string;
  title: string;
  icon: string;         // Material Symbols
  open: () => void;     // 打开该 App（装配窗口）
}

export class Desktop {
  readonly wm: WindowManager;
  private apps: DesktopApp[] = [];
  private taskbarItemsEl: HTMLElement;

  constructor() {
    const host = document.getElementById('window-host')!;
    this.wm = new WindowManager(host);
    this.taskbarItemsEl = document.getElementById('taskbar-items')!;
    this.wm.onChange((items) => this.renderTaskbar(items));
    this.bindStartMenu();
    this.startClock();
  }

  show(): void {
    document.getElementById('desktop')!.classList.remove('hidden');
  }
  hide(): void {
    document.getElementById('desktop')!.classList.add('hidden');
  }

  /** 注册桌面 App（渲染桌面图标 + 开始菜单项） */
  registerApps(apps: DesktopApp[]): void {
    this.apps = apps;
    this.renderIcons();
    this.renderStartMenu();
  }

  private renderIcons(): void {
    const el = document.getElementById('desktop-icons')!;
    el.innerHTML = '';
    for (const app of this.apps) {
      const icon = document.createElement('button');
      icon.className = 'w-20 h-20 flex flex-col items-center justify-center gap-1 text-xs rounded hover:bg-white/10';
      icon.innerHTML = `<span class="material-symbols-outlined" style="font-size:28px;">${app.icon}</span><span>${app.title}</span>`;
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
      item.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px;">${app.icon}</span>${app.title}`;
      item.addEventListener('click', () => { menu.classList.add('hidden'); app.open(); });
      menu.appendChild(item);
    }
  }

  private bindStartMenu(): void {
    const btn = document.getElementById('start-btn')!;
    const menu = document.getElementById('start-menu')!;
    btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
    document.addEventListener('click', () => menu.classList.add('hidden'));
  }

  private renderTaskbar(items: TaskbarItem[]): void {
    this.taskbarItemsEl.innerHTML = '';
    for (const it of items) {
      const btn = document.createElement('button');
      btn.className = `px-3 h-9 flex items-center gap-2 text-xs rounded ${it.active ? 'bg-white/15' : 'hover:bg-white/10'} ${it.minimized ? 'opacity-60' : ''}`;
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">${it.icon}</span><span class="max-w-[120px] truncate">${it.title}</span>`;
      btn.addEventListener('click', () => {
        if (it.active && !it.minimized) this.wm.minimize(it.id);
        else this.wm.focus(it.id);
      });
      this.taskbarItemsEl.appendChild(btn);
    }
  }

  private startClock(): void {
    const el = document.getElementById('taskbar-clock')!;
    const tick = () => {
      const d = new Date();
      el.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    tick();
    setInterval(tick, 1000 * 15);
  }
}
```

- [ ] **步骤 3：类型验证**

运行：`pnpm --filter cloudssh-frontend exec tsc --noEmit`
预期：无类型错误。

- [ ] **步骤 4：Commit**

```bash
git add frontend/index.html frontend/src/desktop.ts
git commit -m "feat(desktop): 桌面外壳（壁纸/图标/任务栏/开始菜单/时钟）"
```

---

## 任务 5：终端 App `apps/terminal-app.ts`

**目标：** `openTerminalWindow()`——把已有 `SSHTerminal` 与 `SFTPPanel` 装进一个桌面窗口，连接真实会话，窗口缩放触发 `fit()`，工具栏切换 SFTP，关窗完整清理。

**前置：** 阅读 `frontend/src/terminal.ts` 确认以下方法签名（任务 1 已引入源码，均在 `main.ts`/`tab-manager.ts` 被调用过）：`new SSHTerminal(containerId)`、`mount()`、`fit()`、`connectWithWebSocket(ws, hostInfo?)`、`disconnect()`、`dispose()`、`getSFTPWebSocketUrl()`、`setSessionReadyHandler(cb)`、`setSessionClosedHandler(cb)`。

**文件：**
- 创建：`frontend/src/apps/terminal-app.ts`

- [ ] **步骤 1：编写实现**

```ts
import { WindowManager } from '../wm/window-manager';
import { SSHTerminal } from '../terminal';
import { SFTPPanel } from '../sftp-panel';

export interface OpenTerminalOptions {
  wsUrl: string;
  name: string;
  hostInfo?: { host: string; port: number; username?: string };
}

let seq = 0;

/** 在桌面上打开一个终端窗口并连接 */
export function openTerminalWindow(wm: WindowManager, opts: OpenTerminalOptions): void {
  const win = wm.openWindow({ title: opts.name, icon: 'terminal', width: 760, height: 480, minWidth: 360, minHeight: 220 });

  // 终端需要一个带 id 的容器
  const containerId = `term-host-${++seq}`;
  const mountEl = document.createElement('div');
  mountEl.id = containerId;
  mountEl.style.cssText = 'position:absolute;inset:0;';
  win.bodyEl.appendChild(mountEl);

  const terminal = new SSHTerminal(containerId);
  let sftp: SFTPPanel | null = null;

  terminal.setSessionReadyHandler(() => {
    win.setDisconnected(false);
    if (!sftp) {
      sftp = new SFTPPanel(() => terminal.getSFTPWebSocketUrl());
      sftp.bindEvents();
    }
    sftp.handleSSHReady();
  });
  terminal.setSessionClosedHandler(() => {
    win.setDisconnected(true);
    sftp?.hide();
  });

  // 窗口缩放 → 终端重排
  win.onResize(() => terminal.fit());

  // 关窗清理（镜像 TabManager.closeTab）
  win.onClose(() => {
    sftp?.dispose(); sftp = null;
    terminal.disconnect();
    terminal.dispose();
  });

  // 工具栏 SFTP 切换按钮（挂在窗口标题栏右侧的 body 内浮层，简单实现）
  const sftpBtn = document.createElement('button');
  sftpBtn.title = 'SFTP 文件传输';
  sftpBtn.className = 'absolute top-1 right-1 z-10 p-1';
  sftpBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">folder_open</span>';
  sftpBtn.addEventListener('click', () => sftp?.toggle());
  win.bodyEl.appendChild(sftpBtn);

  // 挂载并连接
  terminal.mount();
  const ws = new WebSocket(opts.wsUrl);
  ws.binaryType = 'arraybuffer';
  terminal.connectWithWebSocket(ws, opts.hostInfo);
}
```

- [ ] **步骤 2：类型验证**

运行：`pnpm --filter cloudssh-frontend exec tsc --noEmit`
预期：无类型错误（若 `getSFTPWebSocketUrl` 等签名与 `terminal.ts` 不符，按实际签名微调）。

- [ ] **步骤 3：Commit**

```bash
git add frontend/src/apps/terminal-app.ts
git commit -m "feat(app): 终端窗口 App（复用 SSHTerminal + SFTPPanel）"
```

---

## 任务 6：服务器 App、匿名连接接线与 `main.ts` 引导改造

**目标：** 登录后进桌面，注册“服务器”App（窗口内嵌 `ServerList`，连接转 `openTerminalWindow`）；匿名连接表单的连接回调也转 `openTerminalWindow`；替换原三页面引导。

**前置：** 阅读 `frontend/src/server-list.ts`、`frontend/src/auth-form.ts` 确认构造签名。已知：`new ServerList(user, onLogout, onConnect)`，其中 `onConnect(wsUrl, serverName, hostInfo?)`；`ConnectionForm` 目前构造为 `new ConnectionForm({ getTabManager })`，内部在连接成功处创建 tab——需定位该处，改为调用注入的 `onConnect(wsUrl, name, hostInfo)`。

**文件：**
- 创建：`frontend/src/apps/servers-app.ts`
- 修改：`frontend/src/main.ts`、`frontend/src/auth-form.ts`

- [ ] **步骤 1：编写 `servers-app.ts`**

```ts
import { WindowManager } from '../wm/window-manager';
import { ServerList } from '../server-list';
import { openTerminalWindow } from './terminal-app';

type User = { id: number; github_id: number; username: string; avatar_url: string };

/** 打开“服务器”窗口：内嵌 ServerList，连接转为开终端窗口 */
export function openServersWindow(wm: WindowManager, user: User, onLogout: () => void): void {
  const win = wm.openWindow({ title: '服务器', icon: 'dns', width: 820, height: 560, minWidth: 420, minHeight: 320 });

  // ServerList 现有实现渲染到 index.html 中固定的 #server-grid 等节点；
  // 为在窗口内渲染，将其宿主节点移动进窗口 body。
  // 步骤 2 会把 #user-space-section 内的服务器列表容器迁入此处。
  const host = document.getElementById('server-space-host');
  if (host) win.bodyEl.appendChild(host);

  // eslint-disable-next-line no-new
  new ServerList(
    user,
    () => { win.close(); onLogout(); },
    (wsUrl: string, serverName: string, hostInfo?: { host: string; port: number }) => {
      openTerminalWindow(wm, { wsUrl, name: serverName, hostInfo });
    },
  );
}
```

- [ ] **步骤 2：在 `index.html` 内保留 ServerList 所需节点**

把原 `#user-space-section` 主体（`#server-grid`、`#empty-state`、`ADD_SERVER` 按钮等 `ServerList` 依赖的节点）包进一个可迁移容器 `#server-space-host`，默认隐藏（供 `servers-app` 迁入窗口）。保留 `#server-modal` 于 `#app` 顶层不动。

- [ ] **步骤 3：改造 `auth-form.ts` 的连接回调**

定位 `ConnectionForm` 中“连接成功 → 创建 tab / 调 `getTabManager`”的位置，改为调用构造时注入的回调：

```ts
// 构造签名改为：
export class ConnectionForm {
  constructor(private deps: { onConnect: (wsUrl: string, name: string, hostInfo?: { host: string; port: number }) => void }) { /* ... */ }
  // 原先创建 tab 的位置替换为：
  //   this.deps.onConnect(wsUrl, name, hostInfo);
}
```

- [ ] **步骤 4：改造 `main.ts` 引导**

用桌面引导替换三页面 show/hide。核心逻辑：

```ts
import { Desktop } from './desktop';
import { ConnectionForm } from './auth-form';
import { openServersWindow } from './apps/servers-app';
import { openTerminalWindow } from './apps/terminal-app';

let desktop: Desktop | null = null;

function getDesktop(): Desktop {
  if (!desktop) desktop = new Desktop();
  return desktop;
}

function showAuthSection(): void {
  document.getElementById('auth-section')!.classList.remove('hidden');
  getDesktop().hide();
  // 匿名连接：连接成功 → 开终端窗口（登录门也用桌面承载窗口）
  new ConnectionForm({
    onConnect: (wsUrl, name, hostInfo) => {
      document.getElementById('auth-section')!.classList.add('hidden');
      getDesktop().show();
      openTerminalWindow(getDesktop().wm, { wsUrl, name, hostInfo });
    },
  });
}

function showDesktop(user: { id: number; github_id: number; username: string; avatar_url: string }): void {
  document.getElementById('auth-section')!.classList.add('hidden');
  const d = getDesktop();
  d.show();
  d.registerApps([
    { id: 'servers', title: '服务器', icon: 'dns', open: () => openServersWindow(d.wm, user, onLogout) },
  ]);
}

function onLogout(): void {
  fetch('/api/auth/logout', { method: 'POST' }).finally(() => location.reload());
}

async function init(): Promise<void> {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) { showDesktop(await res.json()); return; }
  } catch { /* 未登录 */ }
  showAuthSection();
}
init();
```

> 保留原 `main.ts` 中主题恢复（`restoreTheme`）、`?wsUrl=` 独立终端模式（`isTerminalTab`/`initTerminalTab`）等逻辑：主题恢复在 `init` 前调用；独立终端模式保持原样短路返回，不经过桌面。

- [ ] **步骤 5：类型验证 + 本地运行**

```bash
pnpm --filter cloudssh-frontend exec tsc --noEmit
pnpm dev   # wrangler dev，本地起 API + DO
```

预期：类型通过；本地打开页面，未登录见匿名连接表单，登录后见桌面 + “服务器”图标。

- [ ] **步骤 6：Commit**

```bash
git add frontend/src/apps/servers-app.ts frontend/src/main.ts frontend/src/auth-form.ts frontend/index.html
git commit -m "feat: 桌面引导接入服务器App与匿名连接，替换三页面模型"
```

---

## 任务 7：端到端验证、清理与署名

**目标：** 部署后走通完整手测清单；补全 README 署名（Apache-2.0）。

**文件：**
- 修改：`README.md`

- [ ] **步骤 1：部署**

```bash
cd /d/tool/Claude/ssh
pnpm deploy
```

- [ ] **步骤 2：手测清单（对照规格第 8.3）**

1. GitHub 登录成功进入桌面。
2. “服务器”App 添加一台真实 VPS 并保存（记住多台 VPS）。
3. 连接 → 终端窗口连上真实 VPS，`ls`/`uptime` 有输出。
4. 同时打开两台主机终端窗口，互不干扰。
5. 窗口拖拽 / 缩放 / 最小化 / 最大化还原 / 关闭正常；任务栏点击切换/最小化正常；点击置顶生效。
6. 终端窗口切 SFTP，上传并下载一个文件成功。
7. 匿名连接（不登录填 IP/密码）仍能开终端窗口。

任一项失败 → 用 systematic-debugging 定位后修复再重跑。

- [ ] **步骤 3：改写 `README.md`（署名 + 用法）**

至少包含：本项目基于 [CloudSSH](https://github.com/newbietan/CloudSSH)（Apache-2.0）二次开发，说明改动（类 Windows 桌面前端）、部署步骤（`pnpm install` → 配置 OAuth/DO → `pnpm deploy`）、Cloudflare 免费额度提示。保留 `LICENSE`；如上游有 `NOTICE` 一并保留。

- [ ] **步骤 4：全量测试与类型**

```bash
pnpm test                                   # vitest：window-logic 全绿
pnpm --filter cloudssh-frontend exec tsc --noEmit
```

预期：单测通过，类型无错。

- [ ] **步骤 5：Commit**

```bash
git add README.md
git commit -m "docs: 说明与 CloudSSH 署名（Apache-2.0）"
```

---

## 自检记录

**1. 规格覆盖度**
- 成功标准 1（fork+部署+连真实 VPS）→ 任务 1、任务 7。
- 成功标准 2（桌面外壳）→ 任务 4。
- 成功标准 3（窗口拖拽/缩放/最小最大/置顶/关闭）→ 任务 2（逻辑）+ 任务 3（交互）。
- 成功标准 4（连接开终端窗口、多窗）→ 任务 5、任务 6、任务 7#2.4。
- 成功标准 5（任务栏切换）→ 任务 4（渲染）+ 任务 3（onChange）。
- 成功标准 6（服务器 App / 记住多台 VPS）→ 任务 6、任务 7#2.2。
- 成功标准 7（SFTP 传文件）→ 任务 5、任务 7#2.6。
- 决策：匿名连接（任务 6#4）、GitHub OAuth（不改）、空桌面+服务器App（任务 6#4）、pnpm+Vite+TS（任务 1）、Atlas 归档（任务 1#1）、SFTP 面板留 SP2（任务 5 保留切换面板）。
- 风险点：SFTP 挂载（已确认 body 级抽屉，任务 5 直接复用）、`fit()`（任务 5 onResize）、CF 额度（任务 7#3 README 注明）、前端产物托管（任务 1#3 走 build-html.js）。

**2. 占位符扫描**：无 TODO/待定；错误处理与清理均给出具体代码（任务 5 onClose、任务 3 close）。任务 6#3 因 `auth-form.ts` 内部未读，给出**明确目标接口与替换位置**而非占位；执行第一步即读该文件定位。

**3. 类型一致性**：`WindowHandle`（`bodyEl/focus/minimize/toggleMaximize/close/setTitle/setDisconnected/onResize/onClose`）在任务 3 定义，任务 5/6 一致使用；`openTerminalWindow(wm, opts)`、`openServersWindow(wm, user, onLogout)` 签名跨任务一致；`TaskbarItem`/`deriveTaskbar` 在任务 2 定义，任务 3/4 一致引用。
