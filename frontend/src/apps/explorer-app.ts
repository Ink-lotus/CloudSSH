// 资源管理器 App 入口 —— 装配连接池/标签/UI

import type { WindowManager } from '../wm/window-manager';
import type { ShellContext } from '../shell/types';
import { ConnectionPool } from '../explorer/connection-pool';
import { TabManager } from '../explorer/tab-manager';
import { DesktopExplorer, type ExplorerUICtx } from '../explorer/desktop-explorer';
import { MobileExplorer, type MobileUICtx } from '../explorer/mobile-explorer';
import { renderServerPicker } from '../explorer/server-picker';
import type { ActionsContext } from '../explorer/explorer-actions';
import { connectServerWs } from '../shared/server-data';
import { openTerminalFromWsUrl } from './terminal-app';
import { notify } from '../ui-feedback';
import { t } from '../i18n';
import {
  type ExplorerConnectionKey,
  type ExplorerConnectionRequest,
  type ExplorerTarget,
} from '../explorer/connection-target';
import type { AuthConfig } from '../turnstile';

export interface OpenExplorerOptions {
  authenticated: boolean;
  authConfig: AuthConfig;
  initialRequest?: ExplorerConnectionRequest;
  onLogin?: () => void;
}

export function openExplorerWindow(
  wm: WindowManager,
  ctx?: ShellContext,
  options: OpenExplorerOptions = {
    authenticated: false,
    authConfig: { turnstileEnabled: false, sitekey: '', githubAuthEnabled: false },
  },
): void {
  const win = wm.openWindow({
    title: t('explorer.title'), icon: 'folder',
    width: 900, height: 560, minWidth: 420, minHeight: 320,
  });

  const pool = new ConnectionPool();
  const abortController = new AbortController();
  const requests = new Map<ExplorerConnectionKey, ExplorerConnectionRequest>();

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
  let disposePicker: (() => void) | null = null;

  const connectAndTab = async (request: ExplorerConnectionRequest): Promise<void> => {
    try {
      await tabs.createTab(request, abortController.signal);
      if (abortController.signal.aborted) return;
      requests.set(request.target.key, request);
      mountUI();
    } catch (e) {
      if (abortController.signal.aborted) return;
      notify(e instanceof Error ? e.message : String(e), { title: t('explorer.connectFailed'), variant: 'danger' });
      showPicker();
    }
  };

  const showPicker = (): void => {
    if (abortController.signal.aborted) return;
    disposePicker?.();
    const layer = document.createElement('div');
    layer.style.cssText = 'position:absolute;inset:0;z-index:20;background:var(--surface,#0d0d0d);overflow:auto;';
    uiHost.appendChild(layer);
    void renderServerPicker({
      container: layer,
      authenticated: options.authenticated,
      authConfig: options.authConfig,
      connectedKeys: new Set(pool.getAll().map((p) => p.target.key)),
      onSavedServersLoaded: (savedRequests) => {
        savedRequests.forEach((request) => requests.set(request.target.key, request));
      },
      onPickSaved: async (request) => {
        disposePicker?.(); disposePicker = null; layer.remove(); await connectAndTab(request);
      },
      onSubmitDirect: async (request) => {
        disposePicker?.(); disposePicker = null; layer.remove(); await connectAndTab(request);
      },
      onLogin: options.onLogin,
      onError: (m) => notify(m, { variant: 'danger' }),
    }).then((dispose) => {
      if (abortController.signal.aborted || !layer.isConnected) dispose();
      else disposePicker = dispose;
    });
  };

  const uiCtx: ExplorerUICtx = {
    allTargets: () => {
      const targets = new Map<ExplorerConnectionKey, ExplorerTarget>();
      requests.forEach((request) => targets.set(request.target.key, request.target));
      pool.getAll().forEach((pooled) => targets.set(pooled.target.key, pooled.target));
      return [...targets.values()];
    },
    onNewTab: () => showPicker(),
    onConnectTarget: (target) => {
      const request = pool.getRequest(target.key) ?? requests.get(target.key);
      if (request) void connectAndTab(request);
    },
    onDetachTab: (tabId) => {
      const tab = tabs.getAllTabs().find((tt) => tt.id === tabId);
      if (!tab) return;
      const request = pool.getRequest(tab.connectionKey);
      if (!request) return;
      tabs.closeTab(tabId);
      openExplorerWindow(wm, ctx, { ...options, initialRequest: request });
    },
    onDisconnectServer: (connectionKey) => pool.disconnect(connectionKey),
  };

  const mobileCtx: MobileUICtx = {
    onSwitchServer: () => showPicker(),
    allTargets: () => uiCtx.allTargets(),
    onConnectTarget: (target) => uiCtx.onConnectTarget(target),
    onNewWindow: () => openExplorerWindow(wm, ctx, options),
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
    abortController.abort();
    offMode?.();
    disposePicker?.();
    desktop?.dispose(); mobile?.dispose();
    tabs.dispose();
    pool.disposeAll();
  });

  void (async () => {
    if (options.initialRequest) await connectAndTab(options.initialRequest);
    else showPicker();
  })();
}
