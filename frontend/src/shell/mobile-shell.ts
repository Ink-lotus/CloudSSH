import type { Shell, ShellApp, WindowView, WindowActions, ShellContext } from './types';

const BAR_H = 56;   // 三键底栏高度
const TOP_H = 28;   // 顶部状态条高度

/** 移动呈现层：单 App 全屏 + 主界面图标网格 + 三键底栏（任务·主界面·返回）+ 堆叠任务切换器 */
export class MobileShell implements Shell {
  private apps: ShellApp[] = [];
  private views: WindowView[] = [];          // 由 syncState 缓存，供切换器/主界面键按需使用
  private activeId: string | null = null;
  private chrome: HTMLElement | null = null;
  private homeEl: HTMLElement | null = null;
  private switcherEl: HTMLElement | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  /** 由 ShellController 注入：上下文感知返回（询问当前窗 onBack，未消费则回主界面） */
  backRequest: () => void = () => {};

  constructor(
    private host: HTMLElement,
    private actions: WindowActions,
    private ctx: ShellContext,
  ) {
    void this.ctx; // 预留：App 模式感知走 ctx，本类暂不直接使用
  }

  mount(): void {
    this.host.style.top = `${TOP_H}px`;
    this.host.style.bottom = `${BAR_H}px`;

    // 隐藏桌面 chrome（初始以移动模式加载时 index.html 默认可见，会透出）
    document.getElementById('taskbar')!.style.display = 'none';
    document.getElementById('desktop-icons')!.style.display = 'none';
    document.getElementById('start-menu')!.classList.add('hidden');

    const chrome = document.createElement('div');
    chrome.id = 'mobile-chrome';
    chrome.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:9000;';
    chrome.innerHTML = `
      <div id="m-topbar" style="position:absolute;top:0;left:0;right:0;height:${TOP_H}px;display:flex;align-items:center;justify-content:center;font-size:12px;opacity:.6;z-index:50;pointer-events:none;"></div>
      <div id="m-home" style="position:absolute;top:${TOP_H}px;left:0;right:0;bottom:${BAR_H}px;z-index:10;display:grid;grid-template-columns:repeat(4,1fr);gap:22px 4px;align-content:start;padding:20px 14px;overflow-y:auto;pointer-events:auto;"></div>
      <div id="m-switcher" style="display:none;position:absolute;top:${TOP_H}px;left:0;right:0;bottom:${BAR_H}px;z-index:60;background:rgba(6,9,14,.92);gap:14px;align-items:center;overflow-x:auto;padding:20px;pointer-events:auto;"></div>
      <div id="m-bar" style="position:absolute;left:0;right:0;bottom:0;height:${BAR_H}px;z-index:70;display:flex;align-items:center;justify-content:space-around;background:var(--bg-elevated,#0d1017);border-top:1px solid var(--border-strong,#2a2f3a);pointer-events:auto;">
        <button id="m-task"     style="flex:1;height:100%;font-size:18px;background:transparent;">▢</button>
        <button id="m-home-btn" style="flex:1;height:100%;font-size:18px;background:transparent;">○</button>
        <button id="m-back"     style="flex:1;height:100%;font-size:18px;background:transparent;">◁</button>
      </div>`;
    document.getElementById('desktop')!.appendChild(chrome);
    this.chrome = chrome;
    this.homeEl = chrome.querySelector('#m-home') as HTMLElement;
    this.switcherEl = chrome.querySelector('#m-switcher') as HTMLElement;

    (chrome.querySelector('#m-task') as HTMLElement).addEventListener('click', () => this.toggleSwitcher());
    (chrome.querySelector('#m-home-btn') as HTMLElement).addEventListener('click', () => { this.hideSwitcher(); this.goHome(); });
    (chrome.querySelector('#m-back') as HTMLElement).addEventListener('click', () => this.onBack());

    this.startClock();
    this.renderApps(this.apps);
  }

  unmount(): void {
    if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = null; }
    this.chrome?.remove();
    this.chrome = null;
    this.homeEl = null;
    this.switcherEl = null;
    this.host.style.top = '';
  }

  renderWindow(view: WindowView): void {
    // 全屏铺满 host（host 已由 mount 设好 top/bottom 边界）；可见性由 syncState 决定
    const el = view.rootEl;
    el.style.left = '0'; el.style.top = '0';
    el.style.width = '100%'; el.style.height = '100%';
  }

  removeWindow(_id: string): void { /* 容器由 WM 移除；无每窗装饰需清理 */ }

  syncState(views: WindowView[], activeId: string | null): void {
    this.views = views;
    this.activeId = activeId;
    for (const v of views) {
      v.rootEl.style.display = v.id === activeId ? 'flex' : 'none';
    }
    if (this.homeEl) this.homeEl.style.display = activeId ? 'none' : 'grid';
    if (this.switcherEl && this.switcherEl.style.display !== 'none') this.renderSwitcher();
  }

  renderApps(apps: ShellApp[]): void {
    this.apps = apps;
    if (!this.homeEl) return;
    this.homeEl.innerHTML = '';
    for (const app of apps) {
      const btn = document.createElement('button');
      btn.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;background:transparent;';
      btn.innerHTML =
        `<span class="material-symbols-outlined" style="font-size:30px;width:52px;height:52px;line-height:52px;border-radius:14px;background:var(--bg-elevated,#0d1017);">${app.icon}</span>` +
        `<span>${this.escape(app.title)}</span>`;
      btn.addEventListener('click', () => app.open()); // 单击即开
      this.homeEl.appendChild(btn);
    }
  }

  // ---- 三键行为 ----
  private onBack(): void {
    if (this.switcherEl && this.switcherEl.style.display !== 'none') { this.hideSwitcher(); return; }
    this.backRequest();
  }

  /** 主界面键：隐藏所有窗口回主界面（窗口留后台，仍在切换器） */
  private goHome(): void {
    for (const v of this.views) this.actions.minimize(v.id);
  }

  private toggleSwitcher(): void {
    if (!this.switcherEl) return;
    if (this.switcherEl.style.display === 'none') {
      this.switcherEl.style.display = 'flex';
      this.renderSwitcher();
    } else {
      this.hideSwitcher();
    }
  }
  private hideSwitcher(): void { if (this.switcherEl) this.switcherEl.style.display = 'none'; }

  private renderSwitcher(): void {
    const el = this.switcherEl;
    if (!el) return;
    el.innerHTML = '';
    if (this.views.length === 0) {
      el.innerHTML = '<div style="margin:auto;opacity:.5;font-size:13px;">无打开的窗口</div>';
      return;
    }
    for (const v of this.views) {
      const card = document.createElement('div');
      card.style.cssText = 'flex:0 0 auto;width:180px;height:70%;border:1px solid var(--border-strong,#2a2f3a);border-radius:12px;background:var(--bg-surface,#12151c);display:flex;flex-direction:column;overflow:hidden;touch-action:none;';
      card.innerHTML =
        `<div style="height:26px;display:flex;align-items:center;gap:6px;padding:0 8px;font-size:11px;background:var(--bg-elevated,#0d1017);">` +
        `<span class="material-symbols-outlined" style="font-size:14px;">${v.icon}</span>` +
        `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escape(v.title)}</span></div>` +
        `<div style="flex:1;display:flex;align-items:center;justify-content:center;opacity:.4;font-size:11px;">${this.escape(v.title)}</div>`;
      card.addEventListener('click', () => { this.hideSwitcher(); this.actions.focus(v.id); }); // 单击选择
      this.enableSwipeClose(card, v.id);
      el.appendChild(card);
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
      if (dy < -60) this.actions.close(id);   // 上滑超过阈值 → 关闭
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
}
