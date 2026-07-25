// 移动端资源管理器 —— 单面板 + 竖三点菜单 + 全局菜单

import type { TabManager } from './tab-manager';
import type { ConnectionPool } from './connection-pool';
import type { SFTPFileEntry } from './sftp-connection';
import { showContextMenu, type MenuItem } from './context-menu';
import { showChmodDialog } from './desktop-explorer';
import { t } from '../i18n';
import { requestText, confirmAction } from '../ui-feedback';

export interface MobileUICtx {
  onSwitchServer: () => void;
  onNewWindow: () => void;
  onDisconnect: () => void;
}

function escapeHtml(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

export class MobileExplorer {
  private offCbs: (() => void)[] = [];
  private activeStateOff: (() => void) | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private root: HTMLElement,
    private tabs: TabManager,
    private pool: ConnectionPool,
    private ui: MobileUICtx,
  ) {
    this.offCbs.push(this.tabs.onChange(() => this.render()));
  }

  render(): void {
    const active = this.tabs.getActiveTab();
    if (!active) { this.root.innerHTML = `<div class="p-6 text-on-surface-variant text-xs">${t('explorer.noTab')}</div>`; return; }
    const st = active.state;
    const sel = st.selected.size;
    this.root.innerHTML = `
      <div class="flex flex-col h-full bg-surface text-on-surface text-sm">
        <div class="flex items-center gap-2 px-3 h-11 border-b border-outline-variant shrink-0">
          <span class="material-symbols-outlined" style="font-size:18px;">folder</span>
          <span class="flex-1 truncate text-xs">${escapeHtml(st.currentPath)}</span>
          <button id="m-menu" class="p-1"><span class="material-symbols-outlined">menu</span></button>
        </div>
        ${sel > 0 ? `<div class="flex items-center gap-3 px-3 h-10 border-b border-outline-variant bg-elevated shrink-0 text-xs">
          <span class="flex-1">${t('explorer.selected')} ${sel}</span>
          <button id="m-copy" class="p-1"><span class="material-symbols-outlined" style="font-size:18px;">content_copy</span></button>
          <button id="m-cut" class="p-1"><span class="material-symbols-outlined" style="font-size:18px;">content_cut</span></button>
          <button id="m-del" class="p-1 text-error"><span class="material-symbols-outlined" style="font-size:18px;">delete</span></button>
          <button id="m-clear" class="p-1"><span class="material-symbols-outlined" style="font-size:18px;">close</span></button>
        </div>` : ''}
        <div id="m-list" class="flex-1 overflow-auto"></div>
      </div>
    `;
    const list = this.root.querySelector('#m-list') as HTMLElement;
    list.innerHTML = st.visibleFiles().map((f) => this.renderRow(f, st.selected.has(f.name))).join('')
      || `<div class="p-6 text-on-surface-variant">${t('explorer.empty')}</div>`;
    list.querySelectorAll('.m-row').forEach((el) => this.bindRow(el as HTMLElement, active));

    this.root.querySelector('#m-menu')?.addEventListener('click', (e) => this.globalMenu(e as MouseEvent, active));
    this.root.querySelector('#m-copy')?.addEventListener('click', () => { active.actions.copy(); active.state.clearSelection(); });
    this.root.querySelector('#m-cut')?.addEventListener('click', () => { active.actions.cut(); active.state.clearSelection(); });
    this.root.querySelector('#m-del')?.addEventListener('click', async () => {
      if (await confirmAction({ title: t('explorer.delete'), message: t('explorer.deleteMsg') })) void active.actions.delete();
    });
    this.root.querySelector('#m-clear')?.addEventListener('click', () => active.state.clearSelection());

    this.activeStateOff?.();
    this.activeStateOff = active.state.onChange(() => this.render());
  }

  private renderRow(f: SFTPFileEntry, selected: boolean): string {
    const icon = f.isDir ? 'folder' : (f.isLink ? 'link' : 'description');
    return `<div class="m-row flex items-center gap-3 px-3 py-2.5 border-b border-outline-variant/50 ${selected ? 'bg-primary-container/20' : ''}" data-name="${escapeHtml(f.name)}">
      <span class="material-symbols-outlined" style="font-size:20px;">${icon}</span>
      <div class="flex-1 min-w-0"><div class="truncate">${escapeHtml(f.name)}</div>${f.isDir ? '' : `<div class="text-[11px] text-on-surface-variant">${f.sizeFormatted}</div>`}</div>
      ${f.isDir ? '<span class="material-symbols-outlined text-on-surface-variant" style="font-size:18px;">chevron_right</span>' : ''}
      <button class="m-dots p-1" data-name="${escapeHtml(f.name)}"><span class="material-symbols-outlined" style="font-size:18px;">more_vert</span></button>
    </div>`;
  }

  private bindRow(el: HTMLElement, active: NonNullable<ReturnType<TabManager['getActiveTab']>>): void {
    const name = el.dataset.name!;
    const entry = () => active.state.files.find((f) => f.name === name)!;
    const st = active.state;
    const startLP = () => { this.longPressTimer = setTimeout(() => { st.select(name, 'toggle'); this.longPressTimer = null; }, 500); };
    const cancelLP = () => { if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; } };
    el.addEventListener('touchstart', startLP, { passive: true });
    el.addEventListener('touchend', cancelLP);
    el.addEventListener('touchmove', cancelLP, { passive: true });
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.m-dots')) return;
      const f = entry();
      if (st.selected.size > 0) { st.select(name, 'toggle'); return; }
      if (f.isDir) void active.actions.navigate(st.currentPath.replace(/\/$/, '') + '/' + f.name);
      else this.fileMenu(e as MouseEvent, active, f);
    });
    el.querySelector('.m-dots')?.addEventListener('click', (e) => { e.stopPropagation(); this.fileMenu(e as MouseEvent, active, entry()); });
  }

  private openWithItem(active: NonNullable<ReturnType<TabManager['getActiveTab']>>, name: string): MenuItem {
    return {
      label: t('explorer.openWith'), icon: 'open_in_new', submenu: [
        { label: 'nano', icon: 'edit', onClick: () => void active.actions.openWith(name, 'nano') },
        { label: 'vim', icon: 'edit', onClick: () => void active.actions.openWith(name, 'vim') },
        { label: t('explorer.download'), icon: 'download', onClick: () => void active.actions.openWith(name, 'download') },
      ],
    };
  }

  private fileMenu(e: MouseEvent, active: NonNullable<ReturnType<TabManager['getActiveTab']>>, f: SFTPFileEntry): void {
    if (!active.state.selected.has(f.name)) active.state.select(f.name, 'single');
    const items: MenuItem[] = [];
    if (!f.isDir) items.push(this.openWithItem(active, f.name));
    items.push(
      { label: t('explorer.copy'), icon: 'content_copy', onClick: () => active.actions.copy() },
      { label: t('explorer.move'), icon: 'content_cut', onClick: () => active.actions.cut() },
      { label: t('explorer.rename'), icon: 'drive_file_rename_outline', onClick: async () => {
          const nn = await requestText({ title: t('explorer.rename'), message: t('explorer.renameMsg'), defaultValue: f.name });
          if (nn && nn !== f.name) void active.actions.rename(f.name, nn);
        } },
      { label: t('explorer.delete'), icon: 'delete', danger: true, onClick: async () => {
          if (await confirmAction({ title: t('explorer.delete'), message: t('explorer.deleteMsg') })) void active.actions.delete();
        } },
      { label: t('explorer.properties'), icon: 'settings', onClick: () => showChmodDialog(f, (mode) => void active.actions.chmod(f.name, mode)) },
    );
    showContextMenu(e.clientX, e.clientY, items);
  }

  private globalMenu(e: MouseEvent, active: NonNullable<ReturnType<TabManager['getActiveTab']>>): void {
    const items: MenuItem[] = [
      { label: t('explorer.upload'), icon: 'upload_file', onClick: () => this.pickAndUpload(active) },
      { label: t('explorer.newFolder'), icon: 'create_new_folder', onClick: async () => {
          const nm = await requestText({ title: t('explorer.newFolder'), message: t('explorer.newFolderMsg') });
          if (nm) void active.actions.mkdir(nm);
        } },
      { label: t('explorer.search'), icon: 'search', onClick: async () => {
          const q = await requestText({ title: t('explorer.search'), message: t('explorer.searchMsg') });
          if (q) { const hits = await active.actions.search(q); this.showSearchResults(hits); }
        } },
      { label: t('explorer.paste'), icon: 'content_paste', disabled: !active.state.clipboard, onClick: () => void active.actions.paste() },
      { label: t('explorer.refresh'), icon: 'refresh', onClick: () => void active.actions.refresh() },
      { label: t('explorer.newWindow'), icon: 'open_in_new', onClick: () => this.ui.onNewWindow() },
      { label: t('explorer.switchServer'), icon: 'dns', onClick: () => this.ui.onSwitchServer() },
      { label: t('explorer.disconnect'), icon: 'link_off', danger: true, onClick: () => this.ui.onDisconnect() },
    ];
    showContextMenu(e.clientX, e.clientY, items);
  }

  private pickAndUpload(active: NonNullable<ReturnType<TabManager['getActiveTab']>>): void {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    input.addEventListener('change', () => { if (input.files?.length) void active.actions.upload(input.files); });
    input.click();
  }

  private showSearchResults(hits: { path: string; name: string; dir: string }[]): void {
    const list = this.root.querySelector('#m-list') as HTMLElement;
    const active = this.tabs.getActiveTab(); if (!list || !active) return;
    list.innerHTML = hits.map((h) => `<div class="m-hit flex items-center gap-2 px-3 py-2 border-b border-outline-variant/50" data-dir="${escapeHtml(h.dir)}"><span class="material-symbols-outlined" style="font-size:18px;">description</span><span class="truncate text-xs">${escapeHtml(h.path)}</span></div>`).join('');
    list.querySelectorAll('.m-hit').forEach((el) => el.addEventListener('click', () => void active.actions.navigate((el as HTMLElement).dataset.dir!)));
  }

  onBack(): boolean {
    const active = this.tabs.getActiveTab();
    if (!active) return false;
    if (active.state.selected.size > 0) { active.state.clearSelection(); return true; }
    const p = active.state.currentPath;
    if (p === '/' || p === '.') return false;
    const parent = p.replace(/\/[^/]+\/?$/, '') || '/';
    void active.actions.navigate(parent);
    return true;
  }

  dispose(): void {
    this.activeStateOff?.();
    this.offCbs.forEach((f) => f());
    this.root.innerHTML = '';
  }
}
