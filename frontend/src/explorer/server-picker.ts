// 服务器选择页 —— 复用已保存服务器数据

import { fetchSavedServers, type SavedServer } from '../shared/server-data';
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

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
