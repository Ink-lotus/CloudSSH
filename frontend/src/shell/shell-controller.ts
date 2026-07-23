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
