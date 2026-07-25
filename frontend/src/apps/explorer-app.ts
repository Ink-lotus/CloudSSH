// 资源管理器 App 入口 —— 装配连接池/标签/UI

import type { WindowManager } from '../wm/window-manager';
import type { ShellContext } from '../shell/types';
import { ConnectionPool } from '../explorer/connection-pool';
import { TabManager } from '../explorer/tab-manager';
import { DesktopExplorer, type ExplorerUICtx } from '../explorer/desktop-explorer';
import { MobileExplorer, type MobileUICtx } from '../explorer/mobile-explorer';
import { renderServerPicker } from '../explorer/server-picker';
import type { ActionsContext } from '../explorer/explorer-actions';
import { fetchSavedServers, connectServerWs, type SavedServer } from '../shared/server-data';
import { openTerminalFromWsUrl } from './terminal-app';
import { notify } from '../ui-feedback';
import { t } from '../i18n';

export function openExplorerWindow(
  wm: WindowManager,
  ctx?: ShellContext,
  initialServer?: SavedServer,
): void {
  const win = wm.openWindow({
    title: t('explorer.title'), icon: 'folder',
    width: 900, height: 560, minWidth: 420, minHeight: 320,
  });

  const pool = new ConnectionPool();
  let allServers: SavedServer[] = [];

  const actionsCtx: ActionsContext = {
    openInTerminal: (server, command) => {
      void (async () => {
        try {
          const wsUrl = await connectServerWs(server.id);
          openTerminalFromWsUrl(
            wm,
            { wsUrl, name: `${server.name}: ${command}`, hostInfo: { host: server.host, port: server.port }, initialCommand: command },
            ctx,
          );
        } catch (e) {
          notify(e instanceof Error ? e.message : String(e), { variant: 'danger' });
        }
      })();
    },
    notify: (message, variant) => notify(message, { variant: variant ?? 'info' }),
  };

  const tabs = new TabManager(pool, actionsCtx);

  const uiHost = document.createElement('div');
  uiHost.style.cssText = 'position:absolute;inset:0;';
  win.bodyEl.appendChild(uiHost);

  let desktop: DesktopExplorer | null = null;
  let mobile: MobileExplorer | null = null;

  const connectAndTab = async (server: SavedServer): Promise<void> => {
    try {
      await tabs.createTab(server);
      mountUI();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), { title: t('explorer.connectFailed'), variant: 'danger' });
      showPicker();
    }
  };

  const showPicker = (): void => {
    const layer = document.createElement('div');
    layer.style.cssText = 'position:absolute;inset:0;z-index:20;background:var(--surface,#0d0d0d);overflow:auto;';
    uiHost.appendChild(layer);
    void renderServerPicker({
      container: layer,
      connectedIds: new Set(pool.getAll().map((p) => p.server.id)),
      onPick: async (server) => { layer.remove(); await connectAndTab(server); },
      onError: (m) => notify(m, { variant: 'danger' }),
    });
  };

  const uiCtx: ExplorerUICtx = {
    allServers: () => allServers,
    onNewTab: () => showPicker(),
    onConnectServer: (server) => void connectAndTab(server),
    onDetachTab: (tabId) => {
      const tab = tabs.getAllTabs().find((tt) => tt.id === tabId);
      if (!tab) return;
      const server = pool.getServer(tab.serverId);
      if (!server) return;
      tabs.closeTab(tabId);
      openExplorerWindow(wm, ctx, server);
    },
    onDisconnectServer: (sid) => pool.disconnect(sid),
  };

  const mobileCtx: MobileUICtx = {
    onSwitchServer: () => showPicker(),
    onNewWindow: () => openExplorerWindow(wm, ctx),
    onDisconnect: () => { const a = tabs.getActiveTab(); if (a) pool.disconnect(a.serverId); },
  };

  function mountUI(): void {
    const mode = ctx?.getMode() ?? 'desktop';
    desktop?.dispose(); mobile?.dispose();
    desktop = null; mobile = null;
    if (mode === 'mobile') { mobile = new MobileExplorer(uiHost, tabs, pool, mobileCtx); mobile.render(); }
    else { desktop = new DesktopExplorer(uiHost, tabs, pool, uiCtx); desktop.render(); }
  }

  const offMode = ctx?.onModeChange(() => { if (tabs.count() > 0) mountUI(); });
  win.onBack(() => (mobile ? mobile.onBack() : false));
  win.onClose(() => {
    offMode?.();
    desktop?.dispose(); mobile?.dispose();
    tabs.dispose();
    pool.disposeAll();
  });

  void (async () => {
    try { allServers = await fetchSavedServers(); } catch { /* 忽略，选择页会再拉一次 */ }
    if (initialServer) await connectAndTab(initialServer);
    else showPicker();
  })();
}
