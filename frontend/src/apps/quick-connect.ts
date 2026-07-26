import { loadKnownFingerprint, type SSHTerminal } from '../terminal';
import type { WindowHandle } from '../wm/window-manager';
import type { AuthConfig } from '../turnstile';
import { SSHConnectionForm } from './ssh-connection-form';

export interface QuickConnectOptions {
  /** 创建并挂载终端窗口（由 servers-app 注入，负责在桌面开窗） */
  createTerminalWindow: (opts: {
    name: string;
    hostInfo?: { host: string; port: number };
  }) => { terminal: SSHTerminal; win: WindowHandle };
  authConfig: AuthConfig;
}

/** 服务器 App 的直接连接薄包装。 */
export class QuickConnectForm {
  private form: SSHConnectionForm;

  constructor(root: HTMLElement, options: QuickConnectOptions) {
    this.form = new SSHConnectionForm(root, {
      authConfig: options.authConfig,
      onSubmit: async (config, meta) => {
        const { terminal, win } = options.createTerminalWindow({
          name: meta.name,
          hostInfo: { host: config.host, port: config.port },
        });
        try {
          const expectedFingerprint = await loadKnownFingerprint(config.host, config.port);
          await terminal.connect({
            ...config,
            expectedFingerprint: expectedFingerprint || undefined,
          });
        } catch {
          win.close();
        }
      },
    });
  }

  dispose(): void { this.form.dispose(); }
}
