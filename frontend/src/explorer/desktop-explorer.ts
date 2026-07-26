// 桌面资源管理器布局

import type { TabManager } from './tab-manager';
import { tabTitle } from './tab-manager';
import type { ConnectionPool } from './connection-pool';
import type { ExplorerConnectionKey, ExplorerTarget } from './connection-target';
import type { SFTPFileEntry } from './sftp-connection';
import { showContextMenu, closeContextMenu, type MenuItem } from './context-menu';
import { t } from '../i18n';
import { requestText, confirmAction } from '../ui-feedback';

export interface ExplorerUICtx {
  allTargets: () => ExplorerTarget[];
  onNewTab: () => void;
  onConnectTarget: (target: ExplorerTarget) => void;
  onDetachTab: (tabId: string) => void;
  onDisconnectServer: (connectionKey: ExplorerConnectionKey) => void;
}

function escapeHtml(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
function formatTime(sec: number): string {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export class DesktopExplorer {
  private offCbs: (() => void)[] = [];
  private activeStateOff: (() => void) | null = null;
  private treeExpanded = new Map<ExplorerConnectionKey, Set<string>>();
  private treeChildren = new Map<string, SFTPFileEntry[]>();

  constructor(
    private root: HTMLElement,
    private tabs: TabManager,
    private pool: ConnectionPool,
    private ui: ExplorerUICtx,
  ) {
    this.offCbs.push(this.tabs.onChange(() => this.render()));
    this.offCbs.push(this.pool.onChange(() => this.render()));
  }

  render(): void {
    const active = this.tabs.getActiveTab();
    this.root.innerHTML = `
      <div class="flex flex-col h-full bg-surface text-on-surface text-xs" tabindex="0" id="ex-focus">
        <div id="ex-tabbar" class="flex items-center gap-1 px-2 h-9 border-b border-outline-variant bg-elevated shrink-0 overflow-x-auto"></div>
        <div id="ex-toolbar" class="flex items-center gap-2 px-2 h-9 border-b border-outline-variant shrink-0"></div>
        <div class="flex flex-1 min-h-0">
          <div id="ex-tree" class="w-52 shrink-0 border-r border-outline-variant overflow-auto p-1 ${active?.state.treeCollapsed ? 'hidden' : ''}"></div>
          <div id="ex-list" class="flex-1 overflow-auto"></div>
        </div>
        <div id="ex-status" class="flex items-center justify-between px-3 h-6 border-t border-outline-variant text-[11px] text-on-surface-variant shrink-0"></div>
      </div>
    `;
    this.renderTabBar();
    this.renderToolbar();
    this.renderTree();
    this.renderList();
    this.renderStatus();

    this.activeStateOff?.();
    this.activeStateOff = active
      ? active.state.onChange(() => { this.renderToolbar(); this.renderList(); this.renderStatus(); })
      : null;

    (this.root.querySelector('#ex-focus') as HTMLElement)?.addEventListener('keydown', this.onKeydown);
  }

  dispose(): void {
    this.activeStateOff?.();
    this.offCbs.forEach((f) => f());
    closeContextMenu();
    this.root.innerHTML = '';
  }

  // ---- 标签栏 ----
  private renderTabBar(): void {
    const bar = this.root.querySelector('#ex-tabbar') as HTMLElement;
    if (!bar) return;
    const active = this.tabs.getActiveTab();
    bar.innerHTML = this.tabs.getAllTabs().map((tab) => {
      const target = this.pool.getTarget(tab.connectionKey);
      const title = tabTitle(target?.name ?? '?', tab.state.currentPath);
      const on = tab.id === active?.id;
      return `<div class="ex-tab flex items-center gap-1 px-2 py-1 rounded cursor-pointer ${on ? 'bg-surface-variant text-on-surface' : 'text-on-surface-variant hover:bg-surface-variant'}" draggable="true" data-id="${tab.id}">
        <span class="truncate max-w-[140px]">${escapeHtml(title)}</span>
        <span class="ex-tab-close material-symbols-outlined hover:text-error" style="font-size:14px;" data-id="${tab.id}">close</span>
      </div>`;
    }).join('') + `<button id="ex-tab-add" class="px-2 py-1 hover:bg-surface-variant rounded" title="${t('explorer.newTab')}"><span class="material-symbols-outlined" style="font-size:16px;">add</span></button>`;

    bar.querySelectorAll('.ex-tab').forEach((el) => {
      const id = (el as HTMLElement).dataset.id!;
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('ex-tab-close')) return;
        this.tabs.switchTab(id);
      });
      el.addEventListener('auxclick', (e) => { if ((e as MouseEvent).button === 1) this.tabs.closeTab(id); });
      el.addEventListener('dragend', (e) => {
        const barRect = bar.getBoundingClientRect();
        const me = e as DragEvent;
        if (me.clientY > barRect.bottom + 40 || me.clientY < barRect.top - 40) this.ui.onDetachTab(id);
      });
    });
    bar.querySelectorAll('.ex-tab-close').forEach((el) =>
      el.addEventListener('click', (e) => { e.stopPropagation(); this.tabs.closeTab((el as HTMLElement).dataset.id!); }));
    bar.querySelector('#ex-tab-add')?.addEventListener('click', () => this.ui.onNewTab());
  }

  // ---- 工具栏 ----
  private renderToolbar(): void {
    const tb = this.root.querySelector('#ex-toolbar') as HTMLElement;
    const active = this.tabs.getActiveTab();
    if (!tb) return;
    if (!active) { tb.innerHTML = ''; return; }
    const st = active.state;
    tb.innerHTML = `
      <button class="ex-nav p-1 rounded hover:bg-surface-variant" data-act="tree" title="${t('explorer.tree')}"><span class="material-symbols-outlined" style="font-size:16px;">dock_to_right</span></button>
      <button class="ex-nav p-1 rounded hover:bg-surface-variant ${st.canGoBack() ? '' : 'opacity-30 pointer-events-none'}" data-act="back" title="${t('explorer.back')}"><span class="material-symbols-outlined" style="font-size:16px;">arrow_back</span></button>
      <button class="ex-nav p-1 rounded hover:bg-surface-variant ${st.canGoForward() ? '' : 'opacity-30 pointer-events-none'}" data-act="forward"><span class="material-symbols-outlined" style="font-size:16px;">arrow_forward</span></button>
      <button class="ex-nav p-1 rounded hover:bg-surface-variant" data-act="up" title="${t('explorer.up')}"><span class="material-symbols-outlined" style="font-size:16px;">arrow_upward</span></button>
      <button class="ex-nav p-1 rounded hover:bg-surface-variant" data-act="home"><span class="material-symbols-outlined" style="font-size:16px;">home</span></button>
      <button class="ex-nav p-1 rounded hover:bg-surface-variant" data-act="refresh"><span class="material-symbols-outlined" style="font-size:16px;">refresh</span></button>
      <div id="ex-crumb" class="flex-1 flex items-center flex-wrap px-2 overflow-hidden"></div>
      <input id="ex-search" class="terminal-input text-[12px] px-2 py-1 w-40" placeholder="${t('explorer.search')}" value="${st.searchQuery ?? ''}" />
    `;
    const crumb = tb.querySelector('#ex-crumb') as HTMLElement;
    crumb.innerHTML = this.breadcrumb(st.currentPath);
    crumb.querySelectorAll('.ex-crumb').forEach((el) =>
      el.addEventListener('click', () => active.actions.navigate((el as HTMLElement).dataset.path!)));
    tb.querySelectorAll('.ex-nav').forEach((el) => el.addEventListener('click', () => {
      const act = (el as HTMLElement).dataset.act;
      if (act === 'back') void active.actions.goBack();
      else if (act === 'forward') void active.actions.goForward();
      else if (act === 'up') { const p = st.currentPath.replace(/\/[^/]+\/?$/, '') || '/'; void active.actions.navigate(p); }
      else if (act === 'home') void active.actions.goHome();
      else if (act === 'refresh') void active.actions.refresh();
      else if (act === 'tree') { st.treeCollapsed = !st.treeCollapsed; this.render(); }
    }));
    const search = tb.querySelector('#ex-search') as HTMLInputElement;
    search.addEventListener('input', () => active.actions.filter(search.value));
    search.addEventListener('keydown', async (e) => {
      if ((e as KeyboardEvent).key === 'Enter' && search.value.trim()) {
        const hits = await active.actions.search(search.value.trim());
        this.showSearchResults(hits);
      }
    });
  }

  private breadcrumb(path: string): string {
    const parts = path.split('/').filter(Boolean);
    let acc = '';
    const segs = [`<span class="ex-crumb cursor-pointer hover:text-primary-container" data-path="/">/</span>`];
    for (const p of parts) {
      acc += '/' + p;
      segs.push(`<span class="ex-crumb cursor-pointer hover:text-primary-container" data-path="${acc}">${escapeHtml(p)}</span>`);
    }
    return segs.join('<span class="text-on-surface-variant mx-0.5">/</span>');
  }

  // ---- 目录树 ----
  private renderTree(): void {
    const tree = this.root.querySelector('#ex-tree') as HTMLElement;
    if (!tree) return;
    const active = this.tabs.getActiveTab();
    tree.innerHTML = this.ui.allTargets().map((target) => {
      const key = target.key;
      const connected = this.pool.isConnected(key);
      const dot = connected ? '<span class="w-1.5 h-1.5 rounded-full bg-primary-container"></span>' : '<span class="w-1.5 h-1.5 rounded-full border border-outline-variant"></span>';
      const expanded = connected && this.treeExpanded.has(key);
      const childrenHtml = expanded ? this.renderTreeChildren(key, active?.state.currentPath ?? '/') : '';
      return `<div>
        <div class="ex-srv flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer hover:bg-surface-variant" data-key="${escapeHtml(key)}">
          ${connected ? `<span class="ex-srv-toggle material-symbols-outlined" style="font-size:14px;" data-key="${escapeHtml(key)}">${expanded ? 'expand_more' : 'chevron_right'}</span>` : '<span style="width:14px;"></span>'}
          ${dot}<span class="truncate flex-1">${escapeHtml(target.name)}</span>
        </div>
        <div class="ml-3">${childrenHtml}</div>
      </div>`;
    }).join('');

    tree.querySelectorAll('.ex-srv').forEach((el) => el.addEventListener('click', async (e) => {
      if ((e.target as HTMLElement).classList.contains('ex-srv-toggle')) return;
      const key = (el as HTMLElement).dataset.key as ExplorerConnectionKey;
      const target = this.ui.allTargets().find((item) => item.key === key);
      if (target) this.ui.onConnectTarget(target);
    }));
    tree.querySelectorAll('.ex-srv-toggle').forEach((el) => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key = (el as HTMLElement).dataset.key as ExplorerConnectionKey;
      await this.toggleServerTree(key);
    }));
    tree.querySelectorAll('.ex-tnode').forEach((el) => {
      const key = (el as HTMLElement).dataset.key as ExplorerConnectionKey;
      const path = (el as HTMLElement).dataset.path!;
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('ex-tnode-toggle')) return;
        if (active && active.connectionKey === key) void active.actions.navigate(path);
      });
    });
    tree.querySelectorAll('.ex-tnode-toggle').forEach((el) => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key = (el as HTMLElement).dataset.key as ExplorerConnectionKey;
      await this.toggleTreeDir(key, (el as HTMLElement).dataset.path!);
    }));
  }

  private renderTreeChildren(key: ExplorerConnectionKey, _cur: string): string {
    const set = this.treeExpanded.get(key);
    if (!set) return '';
    return this.renderTreeLevel(key, '.', 0);
  }
  private renderTreeLevel(key: ExplorerConnectionKey, path: string, depth: number): string {
    if (depth > 8) return '';
    const dirs = this.treeChildren.get(`${key}:${path}`) || [];
    return dirs.map((d) => {
      const childPath = path === '.' ? d.name : `${path}/${d.name}`;
      const isExp = this.treeExpanded.get(key)?.has(childPath);
      return `<div>
        <div class="ex-tnode flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer hover:bg-surface-variant" data-key="${escapeHtml(key)}" data-path="${escapeHtml(childPath)}">
          <span class="ex-tnode-toggle material-symbols-outlined" style="font-size:13px;" data-key="${escapeHtml(key)}" data-path="${escapeHtml(childPath)}">${isExp ? 'expand_more' : 'chevron_right'}</span>
          <span class="material-symbols-outlined" style="font-size:13px;">folder</span>
          <span class="truncate">${escapeHtml(d.name)}</span>
        </div>
        ${isExp ? `<div class="ml-3">${this.renderTreeLevel(key, childPath, depth + 1)}</div>` : ''}
      </div>`;
    }).join('');
  }

  private async toggleServerTree(key: ExplorerConnectionKey): Promise<void> {
    if (this.treeExpanded.has(key)) { this.treeExpanded.delete(key); this.renderTree(); return; }
    this.treeExpanded.set(key, new Set(['.']));
    await this.loadTreeDir(key, '.');
    this.renderTree();
  }
  private async toggleTreeDir(key: ExplorerConnectionKey, path: string): Promise<void> {
    const set = this.treeExpanded.get(key) ?? new Set<string>();
    if (set.has(path)) { set.delete(path); this.treeExpanded.set(key, set); this.renderTree(); return; }
    set.add(path); this.treeExpanded.set(key, set);
    await this.loadTreeDir(key, path);
    this.renderTree();
  }
  private async loadTreeDir(key: ExplorerConnectionKey, path: string): Promise<void> {
    const conn = this.pool.get(key);
    if (!conn) return;
    try {
      const entries = await conn.listDirectory(path);
      this.treeChildren.set(`${key}:${path}`, entries.filter((e) => e.isDir && e.name !== '.' && e.name !== '..'));
    } catch { /* 忽略树加载失败 */ }
  }

  // ---- 文件列表 ----
  private renderList(): void {
    const list = this.root.querySelector('#ex-list') as HTMLElement;
    const active = this.tabs.getActiveTab();
    if (!list) return;
    if (!active) { list.innerHTML = `<div class="p-6 text-on-surface-variant">${t('explorer.noTab')}</div>`; return; }
    const st = active.state;
    const cols = (key: string, label: string) =>
      `<div class="ex-col cursor-pointer hover:text-primary-container ${st.sortBy === key ? 'text-primary-container' : ''}" data-key="${key}">${label}${st.sortBy === key ? (st.sortAsc ? ' ▲' : ' ▼') : ''}</div>`;
    const rows = st.visibleFiles().map((f) => this.renderRow(f, st.selected.has(f.name))).join('');
    list.innerHTML = `
      <div class="grid grid-cols-[1fr_90px_110px_130px] px-2 py-1 border-b border-outline-variant sticky top-0 bg-surface font-bold text-on-surface-variant">
        ${cols('name', t('explorer.name'))}${cols('size', t('explorer.size'))}${cols('permissions', t('explorer.perms'))}${cols('modified', t('explorer.modified'))}
      </div>
      <div id="ex-rows">${rows || `<div class="p-6 text-on-surface-variant">${t('explorer.empty')}</div>`}</div>
    `;
    list.querySelectorAll('.ex-col').forEach((el) =>
      el.addEventListener('click', () => active.actions.sort((el as HTMLElement).dataset.key as any)));
    list.querySelectorAll('.ex-row').forEach((el) => this.bindRow(el as HTMLElement, active));
    (list.querySelector('#ex-rows') as HTMLElement).addEventListener('contextmenu', (e) => {
      if ((e.target as HTMLElement).closest('.ex-row')) return;
      e.preventDefault();
      this.blankMenu(e as MouseEvent, active);
    });
    list.addEventListener('dragover', (e) => e.preventDefault());
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = (e as DragEvent).dataTransfer?.files;
      if (files?.length) void active.actions.upload(files);
    });
  }

  private renderRow(f: SFTPFileEntry, selected: boolean): string {
    const icon = f.isDir ? 'folder' : (f.isLink ? 'link' : 'description');
    return `<div class="ex-row grid grid-cols-[1fr_90px_110px_130px] items-center px-2 py-1 select-none ${selected ? 'bg-primary-container/20' : 'hover:bg-surface-variant'}" data-name="${escapeHtml(f.name)}">
      <div class="flex items-center gap-2 truncate"><span class="material-symbols-outlined" style="font-size:16px;">${icon}</span><span class="truncate">${escapeHtml(f.name)}</span></div>
      <div class="text-right text-on-surface-variant pr-2">${f.isDir ? '' : f.sizeFormatted}</div>
      <div class="font-mono text-[11px] text-on-surface-variant">${f.permissions}</div>
      <div class="text-[11px] text-on-surface-variant">${formatTime(f.modifiedTime)}</div>
    </div>`;
  }

  private bindRow(el: HTMLElement, active: NonNullable<ReturnType<TabManager['getActiveTab']>>): void {
    const name = el.dataset.name!;
    const entry = () => active.state.files.find((f) => f.name === name)!;
    el.addEventListener('click', (e) => {
      const mode = e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'single';
      active.state.select(name, mode);
      (this.root.querySelector('#ex-focus') as HTMLElement)?.focus();
    });
    el.addEventListener('dblclick', (e) => {
      const f = entry();
      if (f.isDir) void active.actions.navigate(active.state.currentPath.replace(/\/$/, '') + '/' + f.name);
      else this.openWithMenu((e as MouseEvent).clientX, (e as MouseEvent).clientY, name);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!active.state.selected.has(name)) active.state.select(name, 'single');
      this.fileMenu(e as MouseEvent, active, entry());
    });
  }

  // ---- 菜单 ----
  private openWithMenu(x: number, y: number, name: string): void {
    const active = this.tabs.getActiveTab(); if (!active) return;
    showContextMenu(x, y, [this.openWithItem(active, name)]);
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
    const items: MenuItem[] = [];
    if (!f.isDir) items.push(this.openWithItem(active, f.name));
    else items.push({ label: t('explorer.open'), icon: 'folder_open', onClick: () => void active.actions.navigate(active.state.currentPath.replace(/\/$/, '') + '/' + f.name) });
    items.push(
      { label: t('explorer.copy'), icon: 'content_copy', onClick: () => active.actions.copy() },
      { label: t('explorer.move'), icon: 'content_cut', onClick: () => active.actions.cut() },
      { label: t('explorer.rename'), icon: 'drive_file_rename_outline', onClick: () => void this.renameSelected(active) },
      { label: t('explorer.delete'), icon: 'delete', danger: true, onClick: () => void this.confirmDelete(active) },
      { label: t('explorer.properties'), icon: 'settings', onClick: () => showChmodDialog(f, (mode) => void active.actions.chmod(f.name, mode)) },
    );
    showContextMenu(e.clientX, e.clientY, items);
  }

  private blankMenu(e: MouseEvent, active: NonNullable<ReturnType<TabManager['getActiveTab']>>): void {
    const items: MenuItem[] = [
      { label: t('explorer.upload'), icon: 'upload_file', onClick: () => this.pickAndUpload(active) },
      { label: t('explorer.newFolder'), icon: 'create_new_folder', onClick: async () => {
          const nm = await requestText({ title: t('explorer.newFolder'), message: t('explorer.newFolderMsg') });
          if (nm) void active.actions.mkdir(nm);
        } },
      { label: t('explorer.paste'), icon: 'content_paste', disabled: !active.state.clipboard, onClick: () => void active.actions.paste() },
      { label: t('explorer.refresh'), icon: 'refresh', onClick: () => void active.actions.refresh() },
    ];
    showContextMenu(e.clientX, e.clientY, items);
  }

  private pickAndUpload(active: NonNullable<ReturnType<TabManager['getActiveTab']>>): void {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    input.addEventListener('change', () => { if (input.files?.length) void active.actions.upload(input.files); });
    input.click();
  }

  // ---- 快捷键 ----
  private async confirmDelete(active: NonNullable<ReturnType<TabManager['getActiveTab']>>): Promise<void> {
    if (!active.state.selected.size) return;
    if (await confirmAction({ title: t('explorer.delete'), message: t('explorer.deleteMsg') })) void active.actions.delete();
  }
  private async renameSelected(active: NonNullable<ReturnType<TabManager['getActiveTab']>>): Promise<void> {
    const sel = active.state.getSelectedEntries();
    if (sel.length !== 1) return;
    const nn = await requestText({ title: t('explorer.rename'), message: t('explorer.renameMsg'), defaultValue: sel[0].name });
    if (nn && nn !== sel[0].name) void active.actions.rename(sel[0].name, nn);
  }
  private onKeydown = (e: KeyboardEvent): void => {
    const active = this.tabs.getActiveTab();
    if (!active) return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'c') { active.actions.copy(); e.preventDefault(); }
    else if (ctrl && e.key.toLowerCase() === 'x') { active.actions.cut(); e.preventDefault(); }
    else if (ctrl && e.key.toLowerCase() === 'v') { void active.actions.paste(); e.preventDefault(); }
    else if (e.key === 'Delete') { void this.confirmDelete(active); e.preventDefault(); }
    else if (e.key === 'F2') { void this.renameSelected(active); e.preventDefault(); }
  };

  // ---- 搜索结果 ----
  private showSearchResults(hits: { path: string; name: string; dir: string }[]): void {
    const list = this.root.querySelector('#ex-list') as HTMLElement;
    const active = this.tabs.getActiveTab(); if (!list || !active) return;
    list.innerHTML = `<div class="p-2 text-on-surface-variant border-b border-outline-variant">${t('explorer.searchResults')}（${hits.length}）</div>` +
      hits.map((h) => `<div class="ex-hit flex items-center gap-2 px-3 py-1 hover:bg-surface-variant cursor-pointer" data-dir="${escapeHtml(h.dir)}"><span class="material-symbols-outlined" style="font-size:15px;">description</span><span class="truncate">${escapeHtml(h.path)}</span></div>`).join('');
    list.querySelectorAll('.ex-hit').forEach((el) =>
      el.addEventListener('click', () => void active.actions.navigate((el as HTMLElement).dataset.dir!)));
  }

  // ---- 状态栏 ----
  private renderStatus(): void {
    const bar = this.root.querySelector('#ex-status') as HTMLElement;
    const active = this.tabs.getActiveTab();
    if (!bar) return;
    if (!active) { bar.innerHTML = ''; return; }
    const st = active.state;
    const sel = st.selected.size;
    const conn = this.pool.get(active.connectionKey);
    const online = conn?.isReady() ?? false;
    bar.innerHTML = `<span>${st.visibleFiles().length} ${t('explorer.items')}${sel ? ` · ${t('explorer.selected')} ${sel}` : ''}</span><span>${st.loading ? t('explorer.loading') : (st.error ? `⚠ ${escapeHtml(st.error)}` : (online ? '● ' + t('explorer.connected') : '○ ' + t('explorer.offline')))}</span>`;
  }
}

/** chmod 属性对话框（桌面/移动共用） */
export function showChmodDialog(entry: SFTPFileEntry, onApply: (mode: number) => void): void {
  const perm = entry.permissionsRaw & 0o777;
  const bit = (mask: number) => (perm & mask) ? 'checked' : '';
  const dlg = document.createElement('dialog');
  dlg.className = 'p-4 rounded bg-surface text-on-surface border border-outline-variant text-xs';
  dlg.innerHTML = `
    <div class="font-bold mb-2">${t('explorer.properties')} — ${escapeHtml(entry.name)}</div>
    <div class="mb-1 text-on-surface-variant">${t('explorer.size')}: ${entry.sizeFormatted} · ${entry.permissions}</div>
    <table class="my-2"><tr><td></td><td>${t('explorer.read')}</td><td>${t('explorer.write')}</td><td>${t('explorer.exec')}</td></tr>
      <tr><td>${t('explorer.owner')}</td><td><input type="checkbox" data-m="256" ${bit(0o400)}></td><td><input type="checkbox" data-m="128" ${bit(0o200)}></td><td><input type="checkbox" data-m="64" ${bit(0o100)}></td></tr>
      <tr><td>${t('explorer.group')}</td><td><input type="checkbox" data-m="32" ${bit(0o040)}></td><td><input type="checkbox" data-m="16" ${bit(0o020)}></td><td><input type="checkbox" data-m="8" ${bit(0o010)}></td></tr>
      <tr><td>${t('explorer.other')}</td><td><input type="checkbox" data-m="4" ${bit(0o004)}></td><td><input type="checkbox" data-m="2" ${bit(0o002)}></td><td><input type="checkbox" data-m="1" ${bit(0o001)}></td></tr>
    </table>
    <div class="flex justify-end gap-2 mt-2"><button id="chmod-cancel" class="px-3 py-1 rounded hover:bg-surface-variant">${t('common.cancel')}</button><button id="chmod-ok" class="px-3 py-1 rounded bg-primary-container text-on-primary-container">${t('common.confirm')}</button></div>
  `;
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.querySelector('#chmod-cancel')?.addEventListener('click', () => { dlg.close(); dlg.remove(); });
  dlg.querySelector('#chmod-ok')?.addEventListener('click', () => {
    let mode = 0;
    dlg.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((c) => { if (c.checked) mode |= Number(c.dataset.m); });
    onApply(mode);
    dlg.close(); dlg.remove();
  });
}
