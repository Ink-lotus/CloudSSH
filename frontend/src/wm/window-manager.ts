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
      'background:var(--bg-surface,#12151c);pointer-events:auto;';
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

  /** 关闭全部窗口（逐个触发 onClose 清理），用于退出登录回到初始态 */
  closeAll(): void {
    Array.from(this.wins.keys()).forEach((id) => this.close(id));
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
