// 标签页管理 —— CRUD、切换、拖出为独立窗口

import { ExplorerState } from './explorer-state';
import { ExplorerActions, type ActionsContext } from './explorer-actions';
import type { ConnectionPool } from './connection-pool';
import type { ExplorerConnectionKey, ExplorerConnectionRequest } from './connection-target';

export interface Tab {
  id: string;
  connectionKey: ExplorerConnectionKey;
  state: ExplorerState;
  actions: ExplorerActions;
}

/** 标签标题：服务器名:当前目录末段（纯逻辑） */
export function tabTitle(serverName: string, path: string): string {
  const base = path === '/' ? '/' : (path.split('/').filter(Boolean).pop() || '/');
  return `${serverName}:${base}`;
}

/** 关闭标签后应激活哪个（纯逻辑） */
export function nextActiveAfterClose(
  ids: string[], closingId: string, currentActive: string,
): string | null {
  if (closingId !== currentActive) return currentActive;
  const idx = ids.indexOf(closingId);
  const remaining = ids.filter((id) => id !== closingId);
  if (!remaining.length) return null;
  return remaining[Math.min(idx, remaining.length - 1)];
}

export class TabManager {
  private tabs: Tab[] = [];
  private activeId: string | null = null;
  private seq = 0;
  private changeCbs = new Set<() => void>();

  constructor(private pool: ConnectionPool, private ctx: ActionsContext) {}

  async createTab(request: ExplorerConnectionRequest): Promise<Tab> {
    await this.pool.connect(request);
    this.pool.acquire(request.target.key);
    const id = `tab-${++this.seq}`;
    const state = new ExplorerState(id, request.target.key);
    const actions = new ExplorerActions(state, this.pool, this.ctx);
    const tab: Tab = { id, connectionKey: request.target.key, state, actions };
    this.tabs.push(tab);
    this.activeId = id;
    this.notify();
    void actions.goHome();
    return tab;
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const ids = this.tabs.map((t) => t.id);
    this.activeId = nextActiveAfterClose(ids, tabId, this.activeId ?? '');
    this.tabs = this.tabs.filter((t) => t.id !== tabId);
    this.pool.release(tab.connectionKey);
    this.notify();
  }

  switchTab(tabId: string): void {
    if (this.tabs.some((t) => t.id === tabId)) { this.activeId = tabId; this.notify(); }
  }
  getActiveTab(): Tab | null { return this.tabs.find((t) => t.id === this.activeId) ?? null; }
  getAllTabs(): Tab[] { return [...this.tabs]; }
  count(): number { return this.tabs.length; }

  onChange(cb: () => void): () => void {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }
  private notify(): void { this.changeCbs.forEach((cb) => cb()); }

  dispose(): void {
    this.tabs.forEach((t) => this.pool.release(t.connectionKey));
    this.tabs = [];
    this.activeId = null;
    this.changeCbs.clear();
  }
}
