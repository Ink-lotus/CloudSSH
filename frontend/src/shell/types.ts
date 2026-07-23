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
