// 服务器选择页 —— 复用已保存服务器数据

import { fetchSavedServers, AuthRequiredError, type SavedServer } from '../shared/server-data';
import { t } from '../i18n';

export interface ServerPickerOptions {
  container: HTMLElement;
  connectedIds: Set<number>;
  onPick: (server: SavedServer) => void;
  onError?: (message: string) => void;
}

/** 渲染服务器选择页到容器 */
export async function renderServerPicker(opts: ServerPickerOptions): Promise<void> {
  const { container } = opts;
  container.innerHTML = `
    <div class="p-6 text-on-surface">
      <div class="text-xs font-bold tracking-[0.1em] text-primary-container mb-4" data-i18n="explorer.connect">${t('explorer.connect')}</div>
      <div id="ep-server-list" class="grid grid-cols-1 sm:grid-cols-2 gap-3"></div>
      <div id="ep-empty" class="hidden text-xs text-on-surface-variant py-8 text-center"></div>
    </div>
  `;
  const list = container.querySelector('#ep-server-list') as HTMLElement;
  const empty = container.querySelector('#ep-empty') as HTMLElement;

  let servers: SavedServer[] = [];
  try {
    servers = await fetchSavedServers();
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      renderLoginPrompt(container);
      return;
    }
    opts.onError?.(e instanceof Error ? e.message : String(e));
    return;
  }

  if (!servers.length) {
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.textContent = t('explorer.noServers');
    return;
  }

  list.innerHTML = servers.map((s) => `
    <button class="ep-card text-left p-4 border border-outline-variant rounded hover:border-primary-container transition-colors cursor-pointer" data-id="${s.id}">
      <div class="flex items-center gap-2 mb-1">
        <span class="material-symbols-outlined text-primary" style="font-size:18px;">dns</span>
        <span class="text-sm font-bold">${escapeHtml(s.name)}</span>
        ${opts.connectedIds.has(s.id) ? '<span class="ml-auto w-2 h-2 rounded-full bg-primary-container"></span>' : ''}
      </div>
      <div class="text-[11px] text-on-surface-variant">${escapeHtml(s.username)}@${escapeHtml(s.host)}:${s.port}</div>
    </button>
  `).join('');

  servers.forEach((s) => {
    const el = list.querySelector(`.ep-card[data-id="${s.id}"]`);
    el?.addEventListener('click', () => opts.onPick(s));
  });
}

function renderLoginPrompt(container: HTMLElement): void {
  container.innerHTML = `
    <div class="flex flex-col items-center justify-center gap-4 p-8 text-on-surface">
      <span class="material-symbols-outlined text-on-surface-variant" style="font-size:48px;">lock</span>
      <div class="text-sm">${t('explorer.loginRequired')}</div>
      <a href="/api/auth/github" class="inline-flex items-center gap-2 px-4 py-2 rounded bg-primary-container text-on-primary-container text-sm hover:opacity-90 transition-opacity cursor-pointer">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        ${t('auth.login')}
      </a>
    </div>
  `;
}

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
