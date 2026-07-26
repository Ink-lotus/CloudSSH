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
import {
  requestFromSavedServer,
  type ExplorerConnectionRequest,
} from '../explorer/connection-target';

export function openExplorerWindow(
  wm: WindowManager,
  ctx?: ShellContext,
  initialRequest?: ExplorerConnectionRequest,
): void {
  const win = wm.openWindow({
    title: t('explorer.title'), icon: 'folder',
    width: 900, height: 560, minWidth: 420, minHeight: 320,
  });

  const pool = new ConnectionPool();
  let allServers: SavedServer[] = [];

  const actionsCtx: ActionsContext = {
    openInTerminal: (request, command) => {
      if (request.connect.source !== 'saved') return;
      const serverId = request.connect.serverId;
      void (async () => {
        try {
          const wsUrl = await connectServerWs(serverId);
          openTerminalFromWsUrl(
            wm,
            { wsUrl, name: `${request.target.name}: ${command}`, hostInfo: { host: request.target.host, port: request.target.port }, initialCommand: command },
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

  const connectAndTab = async (request: ExplorerConnectionRequest): Promise<void> => {
    try {
      await tabs.createTab(request);
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
      connectedKeys: new Set(pool.getAll().map((p) => p.target.key)),
      onPick: async (server) => { layer.remove(); await connectAndTab(requestFromSavedServer(server)); },
      onError: (m) => notify(m, { variant: 'danger' }),
    });
  };

  const uiCtx: ExplorerUICtx = {
    allServers: () => allServers,
    onNewTab: () => showPicker(),
    onConnectServer: (server) => void connectAndTab(requestFromSavedServer(server)),
    onDetachTab: (tabId) => {
      const tab = tabs.getAllTabs().find((tt) => tt.id === tabId);
      if (!tab) return;
      const request = pool.getRequest(tab.connectionKey);
      if (!request) return;
      tabs.closeTab(tabId);
      openExplorerWindow(wm, ctx, request);
    },
    onDisconnectServer: (connectionKey) => pool.disconnect(connectionKey),
  };

  const mobileCtx: MobileUICtx = {
    onSwitchServer: () => showPicker(),
    onNewWindow: () => openExplorerWindow(wm, ctx),
    onDisconnect: () => { const a = tabs.getActiveTab(); if (a) pool.disconnect(a.connectionKey); },
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
    if (initialRequest) await connectAndTab(initialRequest);
    else showPicker();
  })();
}
