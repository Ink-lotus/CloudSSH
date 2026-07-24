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
    const el = this.rootOf(id); if (!el) return;
    const g = deco.maximized
      ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight - TASKBAR_H }
      : deco.geom;
    el.style.left = `${g.x}px`; el.style.top = `${g.y}px`;
    el.style.width = `${g.w}px`; el.style.height = `${g.h}px`;
  }

  private rootOf(id: string): HTMLElement | null {
    // rootEl 通过 titlebar.parentElement 取得（titlebar 是 rootEl 首个子节点）
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
