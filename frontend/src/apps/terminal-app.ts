import { WindowManager, WindowHandle } from '../wm/window-manager';
import { SSHTerminal } from '../terminal';
import { notify } from '../ui-feedback';
import type { ShellContext } from '../shell/types';
import { createSoftKeyBar } from '../mobile/soft-key-bar';

let seq = 0;

/** 校验 wsUrl 为同源 ws/wss，防止连接到不受信任地址 */
function validateWsUrl(wsUrl: string): boolean {
  try {
    const url = new URL(wsUrl);
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return false;
    return url.origin === window.location.origin ||
           url.origin === window.location.origin.replace(/^http/, 'ws');
  } catch {
    return false;
  }
}

export interface CreateTerminalWindowOptions {
  name: string;
  hostInfo?: { host: string; port: number };
  initialCommand?: string;
}

/** 已打开的终端窗口（按 host:port 去重；编辑窗口不参与去重） */
const openTerminals = new Map<string, WindowHandle>();

function hostKey(hostInfo?: { host: string; port: number }): string | null {
  return hostInfo ? `${hostInfo.host}:${hostInfo.port}` : null;
}

/**
 * 在桌面上打开一个终端窗口，装配 SSHTerminal，返回句柄。
 * 不负责建立连接——由调用者决定 connect(config)（匿名）或 connectWithWebSocket(ws)（服务器列表）。
 */
export function createTerminalWindow(
  wm: WindowManager,
  opts: CreateTerminalWindowOptions,
  ctx?: ShellContext,
): { terminal: SSHTerminal; win: WindowHandle } {
  const win = wm.openWindow({
    title: opts.name, icon: 'terminal',
    width: 760, height: 480, minWidth: 360, minHeight: 220,
  });

  const key = hostKey(opts.hostInfo);
  const dedup = key && !opts.initialCommand;
  if (dedup) openTerminals.set(key!, win);

  const containerId = `term-host-${++seq}`;
  const mountEl = document.createElement('div');
  mountEl.id = containerId;
  mountEl.style.cssText = 'position:absolute;inset:0;';
  win.bodyEl.appendChild(mountEl);

  const terminal = new SSHTerminal(containerId);

  terminal.setSessionReadyHandler(() => {
    win.setDisconnected(false);
    if (opts.initialCommand) {
      setTimeout(() => terminal.sendWebSocketMessage(opts.initialCommand + '\n'), 300);
    }
  });
  terminal.setSessionClosedHandler(() => {
    win.setDisconnected(true);
  });

  win.onResize(() => terminal.fit());

  let keyBar: { el: HTMLElement; dispose: () => void } | null = null;
  const mountKeyBar = () => {
    if (keyBar) return;
    keyBar = createSoftKeyBar(terminal);
    win.bodyEl.appendChild(keyBar.el);
    const barH = keyBar.el.offsetHeight || 38;
    mountEl.style.bottom = `${barH}px`;
    terminal.fit();
  };
  const unmountKeyBar = () => {
    keyBar?.dispose(); keyBar = null;
    mountEl.style.bottom = '0';
    terminal.fit();
  };
  const syncKeyBar = (mode: 'desktop' | 'mobile') => (mode === 'mobile' ? mountKeyBar() : unmountKeyBar());
  let offMode: (() => void) | null = null;
  if (ctx) { syncKeyBar(ctx.getMode()); offMode = ctx.onModeChange(syncKeyBar); }

  win.onClose(() => {
    offMode?.();
    keyBar?.dispose();
    terminal.disconnect();
    terminal.dispose();
    if (dedup) openTerminals.delete(key!);
  });

  terminal.mount();
  return { terminal, win };
}

/** 服务器列表路径：用后端返回的 wsUrl（含 one-time-token）开终端窗口并连接 */
export function openTerminalFromWsUrl(
  wm: WindowManager,
  opts: { wsUrl: string; name: string; hostInfo?: { host: string; port: number }; initialCommand?: string },
  ctx?: ShellContext,
): void {
  if (!validateWsUrl(opts.wsUrl)) {
    notify('服务器返回了无效或不受信任的 WebSocket 地址。', { title: '无法建立连接', variant: 'danger' });
    return;
  }

  const key = hostKey(opts.hostInfo);
  if (key && !opts.initialCommand) {
    const existing = openTerminals.get(key);
    if (existing) { existing.focus(); return; }
  }

  const { terminal } = createTerminalWindow(
    wm, { name: opts.name, hostInfo: opts.hostInfo, initialCommand: opts.initialCommand }, ctx,
  );
  const ws = new WebSocket(opts.wsUrl);
  ws.binaryType = 'arraybuffer';
  terminal.connectWithWebSocket(ws, opts.hostInfo);
}
