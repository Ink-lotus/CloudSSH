import { loadKnownFingerprint, type SSHTerminal } from '../terminal';
import type { WindowHandle } from '../wm/window-manager';
import { populateRegionSelect } from '../regions';
import { notify } from '../ui-feedback';
import { onLocaleChange, t, translateDocument } from '../i18n';
import {
  encryptCredentials, decryptCredentials,
  readRecentConnections, saveRecentConnection, deleteRecentConnection,
  type RecentConnection,
} from '../credential-store';
import { TurnstileController, type AuthConfig } from '../turnstile';

export interface QuickConnectOptions {
  /** 创建并挂载终端窗口（由 servers-app 注入，负责在桌面开窗） */
  createTerminalWindow: (opts: { name: string; hostInfo?: { host: string; port: number } }) => { terminal: SSHTerminal; win: WindowHandle };
  authConfig: AuthConfig;
}

/** 匿名快速连接表单：渲染进给定容器，处理连接、最近记录、Turnstile */
export class QuickConnectForm {
  private authMode: 'password' | 'key' = 'password';
  private turnstile: TurnstileController;
  private offLocale: () => void;

  constructor(private root: HTMLElement, private options: QuickConnectOptions) {
    this.turnstile = new TurnstileController(options.authConfig.turnstileEnabled, options.authConfig.sitekey);
    this.render();
    this.loadSavedCredentials();
    this.turnstile.render(this.q('#qc-turnstile-widget') as HTMLElement);
    if (this.turnstile.required) {
      (this.q('#qc-turnstile-container') as HTMLElement).style.display = 'block';
    }
    this.offLocale = onLocaleChange(() => {
      const select = this.q('#qc-region') as HTMLSelectElement | null;
      if (select) populateRegionSelect(select, select.value);
      this.renderRecentConnections();
    });
  }

  dispose(): void { this.offLocale(); }

  private q(sel: string): HTMLElement | null {
    return this.root.querySelector(sel);
  }

  private render(): void {
    this.root.innerHTML = `
      <form class="space-y-6" id="qc-form" style="max-width:480px;margin:0 auto;padding:20px;">
        <div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div class="sm:col-span-3">
            <label class="block text-xs font-bold tracking-[0.1em] text-muted mb-2" data-i18n="auth.host">主机地址</label>
            <div class="flex items-center"><span class="text-muted mr-2">&gt;</span>
              <input id="qc-host" class="terminal-input text-[13px]" placeholder="192.168.1.1 or 2001:db8::1" type="text" required></div>
          </div>
          <div class="sm:col-span-1">
            <label class="block text-xs font-bold tracking-[0.1em] text-muted mb-2" data-i18n="auth.port">端口</label>
            <div class="flex items-center"><span class="text-muted mr-2">:</span>
              <input id="qc-port" class="terminal-input text-[13px]" placeholder="22" type="text" value="22"></div>
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold tracking-[0.1em] text-muted mb-2" data-i18n="auth.user">用户名</label>
          <div class="flex items-center"><span class="material-symbols-outlined text-muted mr-2" style="font-size:16px;">person</span>
            <input id="qc-username" class="terminal-input text-[13px]" placeholder="admin" type="text" required></div>
        </div>
        <div>
          <label class="block text-xs font-bold tracking-[0.1em] text-muted mb-2" data-i18n="auth.method">认证方式</label>
          <div class="flex gap-2 mb-3">
            <button type="button" id="qc-tab-password" class="auth-tab auth-tab-active px-3 py-1 text-[11px] font-bold tracking-[0.1em] cursor-pointer transition-all" data-i18n="common.password">密码</button>
            <button type="button" id="qc-tab-key" class="auth-tab px-3 py-1 text-[11px] font-bold tracking-[0.1em] cursor-pointer transition-all" data-i18n="common.privateKey">私钥</button>
          </div>
          <div id="qc-password-section">
            <div class="flex items-center"><span class="material-symbols-outlined text-muted mr-2" style="font-size:16px;">key</span>
              <input id="qc-password" class="terminal-input text-[13px]" placeholder="••••••••" type="password"></div>
          </div>
          <div id="qc-key-section" style="display:none;">
            <textarea id="qc-private-key" class="terminal-input text-[11px] w-full" rows="5" data-i18n-placeholder="auth.keyPlaceholder" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" style="resize:vertical;border:1px solid var(--border-strong);padding:8px;"></textarea>
            <div class="flex items-center gap-2 mt-2">
              <label for="qc-key-file" class="text-[11px] text-muted hover:text-primary cursor-pointer flex items-center gap-1 border border-dim px-2 py-1 hover:border-[var(--accent)] transition-all">
                <span class="material-symbols-outlined" style="font-size:14px;">upload_file</span>
                <span data-i18n="auth.chooseKeyFile">选择密钥文件</span>
              </label>
              <input type="file" id="qc-key-file" accept=".pem,.key,.txt,.pub" class="hidden">
              <span id="qc-file-name" class="text-[10px] text-muted truncate"></span>
            </div>
          </div>
        </div>
        <div id="qc-turnstile-container" style="display:none;"><div id="qc-turnstile-widget" class="flex justify-center"></div></div>
        <div>
          <label class="block text-xs font-bold tracking-[0.1em] text-muted mb-2"><span data-i18n="auth.regionHint">连接区域</span> <span class="text-[9px] opacity-60" data-i18n="auth.regionOptional">可选；自动模式由 Cloudflare 调度</span></label>
          <select id="qc-region" class="terminal-input text-[13px] cursor-pointer" style="border:1px solid var(--border-strong);padding:6px 8px;"><option value="">自动</option></select>
        </div>
        <div class="flex items-center gap-2 mt-2">
          <input type="checkbox" id="qc-remember" class="accent-[var(--accent)] w-4 h-4 cursor-pointer">
          <label for="qc-remember" class="text-xs text-muted cursor-pointer select-none" data-i18n="auth.remember">记住连接信息</label>
        </div>
        <div class="pt-4">
          <button id="qc-connect" class="connect-btn w-full py-3 px-4 text-xs font-bold tracking-[0.1em] uppercase flex items-center justify-center gap-2" type="button">
            <span class="material-symbols-outlined" style="font-size:18px;">power_settings_new</span>
            <span data-i18n="auth.execute">建立连接</span>
          </button>
        </div>
        <div id="qc-recent-section" class="mt-6 pt-4 border-t border-dim hidden">
          <label class="block text-xs font-bold tracking-[0.1em] text-[var(--accent-secondary)] mb-3" data-i18n="auth.recent">最近连接</label>
          <div id="qc-recent-list" class="space-y-2 max-h-[160px] overflow-y-auto custom-scrollbar pr-1"></div>
        </div>
      </form>`;
    translateDocument(this.root);

    this.q('#qc-connect')!.addEventListener('click', () => this.handleConnect());
    this.q('#qc-form')!.addEventListener('keypress', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.handleConnect();
    });
    populateRegionSelect(this.q('#qc-region') as HTMLSelectElement, '');
    this.q('#qc-tab-password')!.addEventListener('click', () => this.setAuthMode('password'));
    this.q('#qc-tab-key')!.addEventListener('click', () => this.setAuthMode('key'));

    const fileInput = this.q('#qc-key-file') as HTMLInputElement;
    fileInput.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        (this.q('#qc-private-key') as HTMLTextAreaElement).value = await file.text();
        (this.q('#qc-file-name') as HTMLElement).textContent = file.name;
      } catch (error) {
        notify(t('auth.readKeyFailed') + ' ' + (error instanceof Error ? error.message : ''), { title: t('auth.readKeyTitle'), variant: 'danger' });
      }
      fileInput.value = '';
    });
  }

  private setAuthMode(mode: 'password' | 'key'): void {
    this.authMode = mode;
    this.q('#qc-tab-password')!.classList.toggle('auth-tab-active', mode === 'password');
    this.q('#qc-tab-key')!.classList.toggle('auth-tab-active', mode === 'key');
    (this.q('#qc-password-section') as HTMLElement).style.display = mode === 'password' ? '' : 'none';
    (this.q('#qc-key-section') as HTMLElement).style.display = mode === 'key' ? '' : 'none';
  }

  private renderRecentConnections(): void {
    const section = this.q('#qc-recent-section');
    const list = this.q('#qc-recent-list');
    if (!section || !list) return;
    const recent = readRecentConnections();
    if (recent.length === 0) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    list.innerHTML = '';
    recent.forEach((item, index) => {
      const authLabel = item.authMethod === 'publickey' ? 'KEY' : 'PWD';
      const labelText = `${item.username}@${item.host}:${item.port}`;
      const el = document.createElement('div');
      el.className = 'flex justify-between items-center text-xs p-2 border border-dim bg-surface/50 hover:bg-surface hover:border-[var(--accent)] transition-all cursor-pointer group relative';
      el.innerHTML = `
        <div class="flex items-center gap-2 overflow-hidden mr-2 select-none flex-1">
          <span class="material-symbols-outlined text-muted" style="font-size:14px;">history</span>
          <span class="text-on-surface truncate" title="${labelText}">${labelText}</span>
          <span class="text-[9px] font-bold tracking-[0.05em] text-muted border border-dim px-1.5 py-0.2 shrink-0">${authLabel}</span>
        </div>
        <button class="delete-history-btn text-muted hover:text-error flex items-center justify-center p-0.5" title="${t('auth.removeHistory')}">
          <span class="material-symbols-outlined" style="font-size:14px;">close</span>
        </button>`;
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.delete-history-btn')) return;
        this.fillConnection(item);
      });
      el.querySelector('.delete-history-btn')!.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteRecentConnection(index);
        this.renderRecentConnections();
      });
      list.appendChild(el);
    });
  }

  private async fillConnection(item: RecentConnection): Promise<void> {
    (this.q('#qc-host') as HTMLInputElement).value = item.host || '';
    (this.q('#qc-port') as HTMLInputElement).value = String(item.port || 22);
    (this.q('#qc-username') as HTMLInputElement).value = item.username || '';
    (this.q('#qc-region') as HTMLSelectElement).value = item.region || '';
    this.setAuthMode(item.authMethod === 'publickey' ? 'key' : 'password');
    const pw = this.q('#qc-password') as HTMLInputElement;
    const pk = this.q('#qc-private-key') as HTMLTextAreaElement;
    const remember = this.q('#qc-remember') as HTMLInputElement;
    if (item.encryptedCred) {
      const cred = await decryptCredentials(item.encryptedCred);
      pw.value = cred?.password || '';
      pk.value = cred?.privateKey || '';
      remember.checked = !!cred;
    } else {
      pw.value = ''; pk.value = ''; remember.checked = false;
    }
  }

  private loadSavedCredentials(): void {
    const recent = readRecentConnections();
    this.renderRecentConnections();
    if (recent.length > 0) this.fillConnection(recent[0]);
  }

  private async handleConnect(): Promise<void> {
    const host = (this.q('#qc-host') as HTMLInputElement).value.replace(/^\[|\]$/g, '').trim();
    const port = parseInt((this.q('#qc-port') as HTMLInputElement).value || '22');
    const username = (this.q('#qc-username') as HTMLInputElement).value;
    const password = (this.q('#qc-password') as HTMLInputElement).value;
    const privateKey = (this.q('#qc-private-key') as HTMLTextAreaElement).value;
    const remember = (this.q('#qc-remember') as HTMLInputElement).checked;
    const regionValue = (this.q('#qc-region') as HTMLSelectElement).value;

    if (!host || !username) {
      notify(t('auth.validationHostUser'), { title: t('auth.incompleteConnection'), variant: 'warning' });
      (this.q(!host ? '#qc-host' : '#qc-username') as HTMLInputElement)?.focus();
      return;
    }
    if (this.authMode === 'password' && !password) {
      notify(t('auth.validationPassword'), { title: t('auth.incompleteCredentials'), variant: 'warning' });
      (this.q('#qc-password') as HTMLInputElement)?.focus();
      return;
    }
    if (this.authMode === 'key' && !privateKey) {
      notify(t('auth.validationPrivateKey'), { title: t('auth.incompleteCredentials'), variant: 'warning' });
      (this.q('#qc-private-key') as HTMLTextAreaElement)?.focus();
      return;
    }
    if (!this.turnstile.isVerified()) {
      notify(t('auth.turnstileRequired'), { title: t('auth.verificationRequired'), variant: 'warning' });
      this.q('#qc-turnstile-container')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    let encryptedCred: string | undefined;
    if (remember) {
      encryptedCred = await encryptCredentials({
        host, port: String(port), username, password,
        privateKey: this.authMode === 'key' ? privateKey : undefined,
        authMethod: this.authMode === 'key' ? 'publickey' : 'password',
      });
    }
    saveRecentConnection({
      id: `${username}@${host}:${port}`,
      host, port, username,
      authMethod: this.authMode === 'key' ? 'publickey' : 'password',
      timestamp: 0,
      ...(regionValue ? { region: regionValue } : {}),
      ...(encryptedCred ? { encryptedCred } : {}),
    });
    this.renderRecentConnections();

    const { terminal, win } = this.options.createTerminalWindow({ name: `${username}@${host}`, hostInfo: { host, port } });
    try {
      const expectedFingerprint = await loadKnownFingerprint(host, port);
      await terminal.connect({
        host, port, username, password,
        authMethod: this.authMode === 'key' ? 'publickey' : 'password',
        privateKey,
        expectedFingerprint: expectedFingerprint || undefined,
        locationHint: regionValue || undefined,
      });
    } catch {
      win.close();
    }
  }
}
