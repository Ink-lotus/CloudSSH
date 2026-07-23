import type { Shell, ShellApp, WindowView, WindowActions, ShellContext } from './types';

/**
 * 移动呈现层——任务 B 仅提供最小可编译占位（ShellController 需 new 它）。
 * 完整实现（全屏宿主/三键底栏/堆叠切换器/返回分发）在任务 C 填充。
 */
export class MobileShell implements Shell {
  constructor(
    private host: HTMLElement,
    private actions: WindowActions,
    private ctx: ShellContext,
  ) {
    void this.host; void this.actions; void this.ctx;
  }
  mount(): void { /* 任务 C 填充 */ }
  unmount(): void { /* 任务 C 填充 */ }
  renderWindow(_view: WindowView): void { /* 任务 C 填充 */ }
  removeWindow(_id: string): void { /* 任务 C 填充 */ }
  syncState(_views: WindowView[], _activeId: string | null): void { /* 任务 C 填充 */ }
  renderApps(_apps: ShellApp[]): void { /* 任务 C 填充 */ }
}
