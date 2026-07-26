// 资源管理器 App 入口 —— 装配连接池/标签/UI

import type { WindowManager } from '../wm/window-manager';
import type { ShellContext } from '../shell/types';
import { ConnectionPool } from '../explorer/connection-pool';
import { completeDetachedTab, TabManager } from '../explorer/tab-manager';
import { DesktopExplorer, type ExplorerUICtx } from '../explorer/desktop-explorer';
import { MobileExplorer, type MobileUICtx } from '../explorer/mobile-explorer';
import { renderServerPicker } from '../explorer/server-picker';
import type { ActionsContext } from '../explorer/explorer-actions';
import { openExplorerTerminalWindow } from './terminal-app';
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

export interface OpenExplorerResult {
  ready: Promise<void>;
  close: () => void;
}

export function openExplorerWindow(
  wm: WindowManager,
  ctx?: ShellContext,
  options: OpenExplorerOptions = {
    authenticated: false,
    authConfig: { turnstileEnabled: false, sitekey: '', githubAuthEnabled: false },
  },
): OpenExplorerResult {
  const win = wm.openWindow({
    title: t('explorer.title'), icon: 'folder',
    width: 900, height: 560, minWidth: 420, minHeight: 320,
  });

  const pool = new ConnectionPool();
  const abortController = new AbortController();
  const requests = new Map<ExplorerConnectionKey, ExplorerConnectionRequest>();

  const actionsCtx: ActionsContext = {
    openInTerminal: (request, command) => {
      void openExplorerTerminalWindow(wm, request, command, ctx).catch((error) => {
        notify(error instanceof Error ? error.message : String(error), { variant: 'danger' });
      });
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
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  let readySettled = false;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = () => { readySettled = true; resolve(); };
    rejectReady = (error) => { readySettled = true; reject(error); };
  });

  const connectAndTab = async (request: ExplorerConnectionRequest): Promise<void> => {
    try {
      await tabs.createTab(request, abortController.signal);
      if (abortController.signal.aborted) return;
      requests.set(request.target.key, request);
      mountUI();
      if (!readySettled) resolveReady();
    } catch (e) {
      if (abortController.signal.aborted) return;
      if (options.initialRequest && !readySettled) rejectReady(e);
      notify(e instanceof Error ? e.message : String(e), { title: t('explorer.connectFailed'), variant: 'danger' });
      throw e;
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
        try {
          await connectAndTab(request);
          disposePicker?.(); disposePicker = null; layer.remove();
        } catch { /* 保留选择器以便重试 */ }
      },
      onSubmitDirect: async (request) => {
        await connectAndTab(request);
        disposePicker?.(); disposePicker = null; layer.remove();
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
      if (request) void connectAndTab(request).catch(() => showPicker());
    },
    onDetachTab: (tabId) => {
      const tab = tabs.getAllTabs().find((tt) => tt.id === tabId);
      if (!tab) return;
      const request = pool.getRequest(tab.connectionKey);
      if (!request) return;
      const detached = openExplorerWindow(wm, ctx, { ...options, initialRequest: request });
      void completeDetachedTab(
        detached.ready,
        () => tabs.closeTab(tabId),
        detached.close,
      ).catch((error) => {
        notify(error instanceof Error ? error.message : String(error), { variant: 'danger' });
      });
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
    if (options.initialRequest && !readySettled) {
      rejectReady(new Error('EXPLORER_WINDOW_CLOSED'));
    }
    abortController.abort();
    offMode?.();
    disposePicker?.();
    desktop?.dispose(); mobile?.dispose();
    tabs.dispose();
    pool.disposeAll();
  });

  void (async () => {
    if (options.initialRequest) {
      try { await connectAndTab(options.initialRequest); } catch { /* ready 已携带失败 */ }
    }
    else { showPicker(); resolveReady(); }
  })();

  return { ready, close: () => win.close() };
}
