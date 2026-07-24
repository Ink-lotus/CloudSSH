import type { WindowManager } from '../wm/window-manager';
import type { ShellController } from '../shell/shell-controller';
import { readSelection } from '../shell/mode';
import type { ModeSelection } from '../shell/types';
import {
  t, SUPPORTED_LOCALES, readLanguageSelection, applyLanguageSelection,
  type LanguageSelection,
} from '../i18n';

type User = { id: number; github_id: number; username: string; avatar_url: string };

let settingsWin: { focus: () => void } | null = null;

/** 打开"设置"窗口：账户 + 语言 + 显示模式 + SP3 占位 */
export function openSettingsWindow(
  wm: WindowManager,
  controller: ShellController,
  user: User | null = null,
  onLogout: () => void = () => {},
): void {
  if (settingsWin) { settingsWin.focus(); return; }

  const win = wm.openWindow({ title: '设置', icon: 'settings', width: 520, height: 480, minWidth: 320, minHeight: 300 });
  settingsWin = win;
  win.onClose(() => { settingsWin = null; });

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;overflow-y:auto;padding:20px;';

  const account = user
    ? `<div style="display:flex;align-items:center;gap:10px;">
         <img src="${user.avatar_url}" alt="" style="width:32px;height:32px;border-radius:50%;">
         <span style="font-size:13px;">${user.username}</span>
         <button id="settings-logout" style="margin-left:auto;padding:6px 14px;border:1px solid var(--error,#ffb4ab);color:var(--error,#ffb4ab);border-radius:8px;background:transparent;font-size:12px;">${t('auth.logout')}</button>
       </div>`
    : `<button id="settings-login" style="padding:8px 16px;border:1px solid var(--border-strong,#2a2f3a);border-radius:8px;background:transparent;font-size:13px;display:inline-flex;align-items:center;gap:8px;">
         <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
         <span>${t('auth.login')}</span>
       </button>`;

  const langOptions = (['auto', ...SUPPORTED_LOCALES] as LanguageSelection[])
    .map((v) => `<option value="${v}">${v === 'auto' ? t('language.auto') : t(v === 'zh-CN' ? 'language.zhCN' : 'language.enUS')}</option>`)
    .join('');

  wrap.innerHTML = `
    <div style="font-size:12px;opacity:.7;margin-bottom:8px;">账户</div>
    <div id="settings-account" style="margin-bottom:24px;">${account}</div>

    <div style="font-size:12px;opacity:.7;margin-bottom:8px;">${t('language.label')}</div>
    <select id="settings-lang" style="padding:6px 10px;border:1px solid var(--border-strong,#2a2f3a);border-radius:8px;background:var(--bg-surface,#12151c);font-size:13px;min-width:160px;">${langOptions}</select>

    <div style="margin-top:24px;font-size:12px;opacity:.7;margin-bottom:8px;">显示模式</div>
    <div id="settings-mode" style="display:inline-flex;border:1px solid var(--border-strong,#2a2f3a);border-radius:10px;overflow:hidden;font-size:13px;">
      <button data-mode="auto"    style="padding:8px 18px;background:transparent;">自动</button>
      <button data-mode="desktop" style="padding:8px 18px;border-left:1px solid var(--border-strong,#2a2f3a);background:transparent;">桌面</button>
      <button data-mode="mobile"  style="padding:8px 18px;border-left:1px solid var(--border-strong,#2a2f3a);background:transparent;">移动</button>
    </div>
    <p style="margin-top:12px;font-size:11px;opacity:.6;line-height:1.6;">「自动」按设备（触屏/宽度）实时判断；选「桌面/移动」将永久覆盖，直到改回自动。</p>

    <div style="margin-top:24px;font-size:12px;opacity:.4;">主题 / 壁纸（后续版本）</div>`;
  win.bodyEl.appendChild(wrap);

  // 账户按钮
  wrap.querySelector('#settings-login')?.addEventListener('click', () => { window.location.href = '/api/auth/github'; });
  wrap.querySelector('#settings-logout')?.addEventListener('click', () => onLogout());

  // 语言下拉
  const langSel = wrap.querySelector('#settings-lang') as HTMLSelectElement;
  langSel.value = readLanguageSelection();
  langSel.addEventListener('change', () => applyLanguageSelection(langSel.value as LanguageSelection));

  // 显示模式
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
