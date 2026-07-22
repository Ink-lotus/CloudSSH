import { THEMES } from './terminal';
import type { SSHTerminal } from './terminal';
import type { WindowHandle } from './wm/window-manager';
import { ConnectionForm } from './auth-form';
import { AIConfigPanel } from './ai-config';
import { initI18n, onLocaleChange, t } from './i18n';
import { Desktop } from './desktop';
import { openServersWindow } from './apps/servers-app';
import { createTerminalWindow } from './apps/terminal-app';

type User = { id: number; github_id: number; username: string; avatar_url: string };

// ==================== 桌面引导 ====================

let desktop: Desktop | null = null;
let connectionForm: ConnectionForm | null = null;

function getDesktop(): Desktop {
  if (!desktop) desktop = new Desktop();
  return desktop;
}

/** 隐藏登录页、显示桌面并创建终端窗口（注入给 ConnectionForm 的匿名连接使用） */
function createTerminalWindowOnDesktop(
  opts: { name: string; hostInfo?: { host: string; port: number } },
): { terminal: SSHTerminal; win: WindowHandle } {
  document.getElementById('auth-section')!.classList.add('hidden');
  const d = getDesktop();
  d.show();
  return createTerminalWindow(d.wm, opts);
}

/** 未登录：显示匿名连接表单 */
function showAuthSection(): void {
  getDesktop().hide();
  document.getElementById('auth-section')!.classList.remove('hidden');
  if (!connectionForm) {
    connectionForm = new ConnectionForm({ createTerminalWindow: createTerminalWindowOnDesktop });
  }
}

/** 已登录：进入桌面，注册“服务器”App */
function showDesktop(user: User): void {
  document.getElementById('auth-section')!.classList.add('hidden');
  const d = getDesktop();
  d.show();
  d.registerApps([
    { id: 'servers', title: t('server.list'), icon: 'dns', open: () => openServersWindow(d.wm, user, onLogout) },
  ]);
}

function onLogout(): void {
  fetch('/api/auth/logout', { method: 'POST' }).finally(() => location.reload());
}

// ==================== AI 配置面板（供 server-list 动态调用） ====================

const aiConfigPanel = new AIConfigPanel();

/** 显示 AI 配置面板（server-list 通过 import('./main') 动态调用） */
export function showAIConfig(): void {
  aiConfigPanel.show();
}

// ==================== 主题恢复（沿用 1.2.0，自包含，仅设置 UI 变量） ====================

const CUSTOM_THEME_VALUE = '__custom__';
// 主题选择器 UI 已随终端页移除；此处为 null，下述逻辑对其做空值保护
const themeSelector = document.getElementById('theme-selector') as HTMLSelectElement | null;

function ensureCustomOption(): void {
  if (!themeSelector) return;
  if (!themeSelector.querySelector(`option[value="${CUSTOM_THEME_VALUE}"]`)) {
    const opt = document.createElement('option');
    opt.value = CUSTOM_THEME_VALUE;
    opt.textContent = t('theme.custom');
    themeSelector.insertBefore(opt, themeSelector.firstChild);
  }
}

/** 恢复主题（在 init 时调用，仅设置文档根的 UI 变量） */
async function restoreTheme(): Promise<void> {
  const selection = localStorage.getItem('cloudssh_theme_selection');

  // 尝试从云端加载自定义主题
  let cloudTheme: Record<string, unknown> | null = null;
  try {
    const res = await fetch('/api/user/theme');
    if (res.ok) {
      const { theme } = await res.json() as { theme: Record<string, unknown> | null };
      if (theme) {
        cloudTheme = theme;
        localStorage.setItem('cloudssh_imported_theme', JSON.stringify(theme));
        ensureCustomOption();
      }
    }
  } catch { /* 未登录，忽略 */ }

  if (!cloudTheme) {
    const localRaw = localStorage.getItem('cloudssh_imported_theme');
    if (localRaw) {
      try {
        JSON.parse(localRaw);
        ensureCustomOption();
      } catch {
        localStorage.removeItem('cloudssh_imported_theme');
      }
    }
  }

  if (selection === CUSTOM_THEME_VALUE) {
    const raw = localStorage.getItem('cloudssh_imported_theme');
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data.ui) {
          const root = document.documentElement;
          Object.entries(data.ui).forEach(([prop, val]) => {
            root.style.setProperty(prop, val as string);
          });
        }
        if (themeSelector) themeSelector.value = CUSTOM_THEME_VALUE;
        return;
      } catch { /* ignore */ }
    }
  }

  if (selection && THEMES[selection as keyof typeof THEMES]) {
    const { UI_THEMES } = await import('./terminal');
    const uiVars = UI_THEMES[selection as keyof typeof THEMES];
    if (uiVars) {
      const root = document.documentElement;
      Object.entries(uiVars).forEach(([prop, val]) => {
        root.style.setProperty(prop, val);
      });
    }
    if (themeSelector) themeSelector.value = selection;
    return;
  }

  // 默认主题：只设置 UI 变量
  const { UI_THEMES } = await import('./terminal');
  const uiVars = UI_THEMES.cyberpunk;
  if (uiVars) {
    const root = document.documentElement;
    Object.entries(uiVars).forEach(([prop, val]) => {
      root.style.setProperty(prop, val);
    });
  }
  if (themeSelector) themeSelector.value = 'cyberpunk';
}

// ==================== 初始化 ====================

async function init(): Promise<void> {
  initI18n();
  onLocaleChange(() => {
    ensureCustomOption();
    const customOption = themeSelector?.querySelector<HTMLOptionElement>(`option[value="${CUSTOM_THEME_VALUE}"]`);
    if (customOption) customOption.textContent = t('theme.custom');
  });
  await restoreTheme();

  const yearEl = document.getElementById('user-copyright-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear().toString();

  try {
    const meRes = await fetch('/api/auth/me');
    if (meRes.ok) {
      showDesktop((await meRes.json()) as User);
      return;
    }
  } catch {
    // /api/auth/me 失败 → 未登录，显示匿名连接表单
  }
  showAuthSection();
}

init();
