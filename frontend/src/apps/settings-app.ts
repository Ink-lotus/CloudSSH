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
      <button data-mode="auto"    style="padding:8px 18px;background:transparent;">自动</button>
      <button data-mode="desktop" style="padding:8px 18px;border-left:1px solid var(--border-strong,#2a2f3a);background:transparent;">桌面</button>
      <button data-mode="mobile"  style="padding:8px 18px;border-left:1px solid var(--border-strong,#2a2f3a);background:transparent;">移动</button>
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
