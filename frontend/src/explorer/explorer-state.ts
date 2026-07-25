// 单标签页状态 —— 选择/排序/历史/剪贴板纯逻辑 + onChange 通知

import type { SFTPFileEntry } from './sftp-connection';

export type SortKey = 'name' | 'size' | 'modified' | 'permissions';

export interface Clipboard {
  files: SFTPFileEntry[];
  sourcePath: string;
  sourceServerId: number;
  mode: 'copy' | 'move';
}

export class ExplorerState {
  readonly tabId: string;
  serverId: number;
  currentPath = '/';
  files: SFTPFileEntry[] = [];
  history: string[] = [];
  forwardStack: string[] = [];
  selected = new Set<string>();
  lastClicked: string | null = null;
  clipboard: Clipboard | null = null;
  loading = false;
  error: string | null = null;
  sortBy: SortKey = 'name';
  sortAsc = true;
  treeCollapsed = false;
  searchQuery: string | null = null;

  private changeCbs = new Set<() => void>();

  constructor(tabId: string, serverId: number) {
    this.tabId = tabId;
    this.serverId = serverId;
  }

  // ---- 选择 ----
  select(name: string, mode: 'single' | 'toggle' | 'range'): void {
    if (mode === 'single') {
      this.selected = new Set([name]);
      this.lastClicked = name;
    } else if (mode === 'toggle') {
      if (this.selected.has(name)) this.selected.delete(name);
      else this.selected.add(name);
      this.lastClicked = name;
    } else {
      const names = this.visibleFiles().map((f) => f.name);
      const anchor = this.lastClicked ?? name;
      const i1 = names.indexOf(anchor);
      const i2 = names.indexOf(name);
      if (i1 >= 0 && i2 >= 0) {
        const [lo, hi] = i1 <= i2 ? [i1, i2] : [i2, i1];
        this.selected = new Set(names.slice(lo, hi + 1));
      }
    }
    this.notify();
  }
  selectAll(): void {
    this.selected = new Set(this.visibleFiles().map((f) => f.name));
    this.notify();
  }
  clearSelection(): void {
    this.selected.clear();
    this.lastClicked = null;
    this.notify();
  }
  getSelectedEntries(): SFTPFileEntry[] {
    return this.files.filter((f) => this.selected.has(f.name));
  }

  // ---- 文件与排序 ----
  setFiles(files: SFTPFileEntry[]): void {
    this.files = files;
    this.selected.clear();
    this.lastClicked = null;
    this.notify();
  }
  visibleFiles(): SFTPFileEntry[] {
    let list = this.files;
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter((f) => f.name.toLowerCase().includes(q));
    }
    const dir = this.sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let cmp = 0;
      switch (this.sortBy) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'size': cmp = a.size - b.size; break;
        case 'modified': cmp = a.modifiedTime - b.modifiedTime; break;
        case 'permissions': cmp = a.permissionsRaw - b.permissionsRaw; break;
      }
      return cmp * dir;
    });
  }
  toggleSort(by: SortKey): void {
    if (this.sortBy === by) this.sortAsc = !this.sortAsc;
    else { this.sortBy = by; this.sortAsc = true; }
    this.notify();
  }

  // ---- 导航历史 ----
  canGoBack(): boolean { return this.history.length > 0; }
  canGoForward(): boolean { return this.forwardStack.length > 0; }
  pushCurrent(to: string): void {
    if (to === this.currentPath) return;
    this.history.push(this.currentPath);
    this.forwardStack = [];
    this.currentPath = to;
  }
  stepBack(): string | null {
    if (!this.history.length) return null;
    this.forwardStack.push(this.currentPath);
    this.currentPath = this.history.pop()!;
    return this.currentPath;
  }
  stepForward(): string | null {
    if (!this.forwardStack.length) return null;
    this.history.push(this.currentPath);
    this.currentPath = this.forwardStack.pop()!;
    return this.currentPath;
  }

  // ---- 通知 ----
  onChange(cb: () => void): () => void {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }
  notify(): void { this.changeCbs.forEach((cb) => cb()); }
}
