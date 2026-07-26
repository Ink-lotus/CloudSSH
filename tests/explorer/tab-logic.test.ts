import { describe, it, expect } from 'vitest';
import { tabTitle, nextActiveAfterClose, TabManager } from '../../frontend/src/explorer/tab-manager';
import type { ConnectionPool } from '../../frontend/src/explorer/connection-pool';
import { requestFromSavedServer } from '../../frontend/src/explorer/connection-target';

describe('tabTitle', () => {
  it('根目录显示 服务器名:/', () => {
    expect(tabTitle('开发机', '/')).toBe('开发机:/');
  });
  it('深层目录取末段', () => {
    expect(tabTitle('生产机', '/var/log/nginx')).toBe('生产机:nginx');
  });
});

describe('nextActiveAfterClose', () => {
  it('关闭非当前标签，active 不变', () => {
    expect(nextActiveAfterClose(['a', 'b', 'c'], 'a', 'b')).toBe('b');
  });
  it('关闭当前标签，选原位置的后一个', () => {
    expect(nextActiveAfterClose(['a', 'b', 'c'], 'b', 'b')).toBe('c');
  });
  it('关闭最后一个当前标签，选前一个', () => {
    expect(nextActiveAfterClose(['a', 'b', 'c'], 'c', 'c')).toBe('b');
  });
  it('关闭唯一标签，返回 null', () => {
    expect(nextActiveAfterClose(['a'], 'a', 'a')).toBeNull();
  });
});

describe('TabManager connection key lifecycle', () => {
  it('closes a tab by releasing its connection key', async () => {
    let released: unknown;
    const pool = {
      connect: async () => undefined,
      acquire: () => undefined,
      release: (key: unknown) => { released = key; return 0; },
      get: () => ({ listDirectory: async () => [] }),
    } as unknown as ConnectionPool;
    const tabs = new TabManager(pool, {
      openInTerminal: () => undefined,
      notify: () => undefined,
    });
    const request = requestFromSavedServer({
      id: 7, name: '开发机', host: '10.0.0.2', port: 22, username: 'root',
    });

    const tab = await tabs.createTab(request);
    expect(tab.connectionKey).toBe('saved:7');

    tabs.closeTab(tab.id);
    expect(released).toBe('saved:7');
  });

  it('does not create or acquire a tab after the connection is aborted', async () => {
    let finishConnect!: () => void;
    let acquired = false;
    const pool = {
      connect: () => new Promise<void>((resolve) => { finishConnect = resolve; }),
      acquire: () => { acquired = true; },
      release: () => 0,
    } as unknown as ConnectionPool;
    const tabs = new TabManager(pool, {
      openInTerminal: () => undefined,
      notify: () => undefined,
    });
    const request = requestFromSavedServer({
      id: 7, name: '开发机', host: '10.0.0.2', port: 22, username: 'root',
    });
    const controller = new AbortController();

    const pending = tabs.createTab(request, controller.signal);
    controller.abort();
    finishConnect();

    await expect(pending).rejects.toThrow('EXPLORER_CONNECT_ABORTED');
    expect(acquired).toBe(false);
    expect(tabs.count()).toBe(0);
  });
});
