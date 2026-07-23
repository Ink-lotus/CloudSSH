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
