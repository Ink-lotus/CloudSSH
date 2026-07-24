import { WindowManager, WindowHandle } from '../wm/window-manager';
import { ServerList } from '../server-list';
import { openTerminalFromWsUrl, createTerminalWindow } from './terminal-app';
import { QuickConnectForm } from './quick-connect';
import { fetchAuthConfig } from '../turnstile';
import type { ShellContext } from '../shell/types';

type User = { id: number; github_id: number; username: string; avatar_url: string };

let serversWin: WindowHandle | null = null;
let listInited = false;

/** 打开"服务器"窗口：登录用户→ServerList，匿名用户→QuickConnectForm */
export function openServersWindow(wm: WindowManager, user: User | null, onLogout: () => void, ctx?: ShellContext): void {
  if (serversWin) { serversWin.focus(); return; }
  if (user) openLoggedInServers(wm, user, onLogout, ctx);
  else openAnonymousServers(wm, ctx);
}

/** 登录模式：迁入 #server-space-host，复用 ServerList（与原行为一致） */
function openLoggedInServers(wm: WindowManager, user: User, onLogout: () => void, ctx?: ShellContext): void {
  const host = document.getElementById('server-space-host');
  if (!host) return;

  const win = wm.openWindow({ title: '服务器', icon: 'dns', width: 860, height: 580, minWidth: 460, minHeight: 340 });
  serversWin = win;
  win.bodyEl.appendChild(host);
  host.classList.remove('hidden');

  win.onBack(() => {
    const modal = document.getElementById('server-modal');
    if (modal && !modal.classList.contains('hidden')) {
      (document.getElementById('modal-close-btn') as HTMLElement | null)?.click();
      return true;
    }
    return false;
  });

  win.onClose(() => {
    host.classList.add('hidden');
    document.getElementById('app')?.appendChild(host);
    serversWin = null;
  });

  if (!listInited) {
    listInited = true;
    // eslint-disable-next-line no-new
    new ServerList(
      user,
      onLogout,
      (wsUrl: string, serverName: string, hostInfo?: { host: string; port: number }) => {
        openTerminalFromWsUrl(wm, { wsUrl, name: serverName, hostInfo }, ctx);
      },
    );
  }
}

/** 匿名模式：窗口内挂载精简快速连接表单 */
function openAnonymousServers(wm: WindowManager, ctx?: ShellContext): void {
  const win = wm.openWindow({ title: '服务器', icon: 'dns', width: 560, height: 740, minWidth: 380, minHeight: 400 });
  serversWin = win;

  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;inset:0;overflow-y:auto;';
  win.bodyEl.appendChild(container);

  let form: QuickConnectForm | null = null;
  fetchAuthConfig().then((authConfig) => {
    form = new QuickConnectForm(container, {
      authConfig,
      createTerminalWindow: (opts) => createTerminalWindow(wm, opts, ctx),
    });
  });

  win.onClose(() => { form?.dispose(); serversWin = null; });
}
