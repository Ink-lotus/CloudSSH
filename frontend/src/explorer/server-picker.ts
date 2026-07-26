// 资源管理器连接选择器 —— 已保存服务器 + 直接 SSH

import {
  AuthRequiredError,
  fetchSavedServers,
  type SavedServer,
} from '../shared/server-data';
import { t } from '../i18n';
import type { ExplorerConnectionKey, ExplorerConnectionRequest } from './connection-target';
import { requestFromDirectConfig, requestFromSavedServer } from './connection-target';
import { SSHConnectionForm } from '../apps/ssh-connection-form';
import type { AuthConfig } from '../turnstile';

export type SavedServerLoadState =
  | { status: 'not_loaded' }
  | { status: 'loading' }
  | { status: 'loaded'; servers: SavedServer[] }
  | { status: 'session_expired' }
  | { status: 'error'; message: string };

export interface ConnectionPickerState {
  activeSource: 'saved' | 'direct';
  shouldFetchSavedServers: boolean;
  sessionExpired: boolean;
  savedError: string | null;
}

/** 决定连接选择器默认页和保存服务器请求行为。 */
export function connectionPickerState(
  authenticated: boolean,
  load: SavedServerLoadState,
): ConnectionPickerState {
  if (!authenticated) {
    return {
      activeSource: 'direct', shouldFetchSavedServers: false,
      sessionExpired: false, savedError: null,
    };
  }
  if (load.status === 'not_loaded') {
    return {
      activeSource: 'saved', shouldFetchSavedServers: true,
      sessionExpired: false, savedError: null,
    };
  }
  if (load.status === 'loading') {
    return {
      activeSource: 'saved', shouldFetchSavedServers: false,
      sessionExpired: false, savedError: null,
    };
  }
  if (load.status === 'loaded') {
    return {
      activeSource: load.servers.length ? 'saved' : 'direct',
      shouldFetchSavedServers: false,
      sessionExpired: false,
      savedError: null,
    };
  }
  if (load.status === 'session_expired') {
    return {
      activeSource: 'direct', shouldFetchSavedServers: false,
      sessionExpired: true, savedError: null,
    };
  }
  return {
    activeSource: 'direct', shouldFetchSavedServers: false,
    sessionExpired: false, savedError: load.message,
  };
}

export interface ServerPickerOptions {
  container: HTMLElement;
  authenticated: boolean;
  authConfig: AuthConfig;
  connectedKeys: Set<ExplorerConnectionKey>;
  onPickSaved: (request: ExplorerConnectionRequest) => void | Promise<void>;
  onSubmitDirect: (request: ExplorerConnectionRequest) => void | Promise<void>;
  onSavedServersLoaded?: (requests: ExplorerConnectionRequest[]) => void;
  onLogin?: () => void;
  onError?: (message: string) => void;
}

/** 渲染连接选择器；返回 disposer 以释放表单的语言监听。 */
export async function renderServerPicker(opts: ServerPickerOptions): Promise<() => void> {
  let load: SavedServerLoadState = { status: 'not_loaded' };
  const initial = connectionPickerState(opts.authenticated, load);
  if (initial.shouldFetchSavedServers) {
    load = { status: 'loading' };
    try {
      load = { status: 'loaded', servers: await fetchSavedServers() };
    } catch (error) {
      load = error instanceof AuthRequiredError
        ? { status: 'session_expired' }
        : { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  const state = connectionPickerState(opts.authenticated, load);
  if (load.status === 'loaded') {
    opts.onSavedServersLoaded?.(load.servers.map(requestFromSavedServer));
  }
  let activeSource = state.activeSource;
  let directForm: SSHConnectionForm | null = null;

  opts.container.innerHTML = `
    <div class="p-6 text-on-surface max-w-3xl mx-auto">
      <div class="text-xs font-bold tracking-[0.1em] text-primary-container mb-4" data-i18n="explorer.connect">${t('explorer.connect')}</div>
      ${opts.authenticated ? `
        <div class="flex gap-2 mb-4" id="ep-source-tabs">
          <button type="button" class="auth-tab px-3 py-1 text-[11px] font-bold tracking-[0.1em]" data-source="saved">${t('explorer.savedServers')}</button>
          <button type="button" class="auth-tab px-3 py-1 text-[11px] font-bold tracking-[0.1em]" data-source="direct">${t('explorer.directConnect')}</button>
        </div>` : ''}
      <div id="ep-notice" class="hidden mb-4 p-3 border border-outline-variant text-xs"></div>
      <div id="ep-content"></div>
    </div>`;

  const content = opts.container.querySelector('#ep-content') as HTMLElement;
  const notice = opts.container.querySelector('#ep-notice') as HTMLElement;

  const renderSaved = (): void => {
    directForm?.dispose();
    directForm = null;
    const servers = load.status === 'loaded' ? load.servers : [];
    if (!servers.length) {
      content.innerHTML = `<div class="text-xs text-on-surface-variant py-8 text-center">${t('explorer.noServers')}</div>`;
      return;
    }
    content.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${servers.map((server) => `
      <button class="ep-card text-left p-4 border border-outline-variant rounded hover:border-primary-container transition-colors cursor-pointer" data-id="${server.id}">
        <div class="flex items-center gap-2 mb-1">
          <span class="material-symbols-outlined text-primary" style="font-size:18px;">dns</span>
          <span class="text-sm font-bold">${escapeHtml(server.name)}</span>
          ${opts.connectedKeys.has(`saved:${server.id}`) ? '<span class="ml-auto w-2 h-2 rounded-full bg-primary-container"></span>' : ''}
        </div>
        <div class="text-[11px] text-on-surface-variant">${escapeHtml(server.username)}@${escapeHtml(server.host)}:${server.port}</div>
      </button>`).join('')}</div>`;
    servers.forEach((server) => {
      content.querySelector(`.ep-card[data-id="${server.id}"]`)?.addEventListener('click', () => {
        void opts.onPickSaved(requestFromSavedServer(server));
      });
    });
  };

  const renderDirect = (): void => {
    directForm?.dispose();
    content.innerHTML = '';
    directForm = new SSHConnectionForm(content, {
      authConfig: opts.authConfig,
      onSubmit: (config) => opts.onSubmitDirect(requestFromDirectConfig(config)),
      onSubmitError: (error) => opts.onError?.(
        error instanceof Error ? error.message : String(error),
      ),
    });
  };

  const showSource = (source: 'saved' | 'direct'): void => {
    activeSource = source;
    opts.container.querySelectorAll<HTMLButtonElement>('#ep-source-tabs [data-source]')
      .forEach((button) => button.classList.toggle(
        'auth-tab-active', button.dataset.source === activeSource,
      ));
    if (activeSource === 'saved') renderSaved();
    else renderDirect();
  };

  if (state.sessionExpired) {
    notice.classList.remove('hidden');
    notice.innerHTML = `${t('explorer.sessionExpired')} ${opts.onLogin ? `<button type="button" id="ep-login" class="text-primary underline">${t('explorer.loginAgain')}</button>` : ''}`;
    notice.querySelector('#ep-login')?.addEventListener('click', () => opts.onLogin?.());
  } else if (state.savedError) {
    notice.classList.remove('hidden');
    notice.textContent = state.savedError;
    opts.onError?.(state.savedError);
  } else if (!opts.authenticated && opts.onLogin) {
    notice.classList.remove('hidden');
    notice.innerHTML = `${t('explorer.loginSaveHint')} <button type="button" id="ep-login" class="text-primary underline">${t('auth.login')}</button>`;
    notice.querySelector('#ep-login')?.addEventListener('click', () => opts.onLogin?.());
  }

  opts.container.querySelectorAll<HTMLButtonElement>('#ep-source-tabs [data-source]')
    .forEach((button) => button.addEventListener('click', () => {
      showSource(button.dataset.source as 'saved' | 'direct');
    }));
  showSource(activeSource);

  return () => directForm?.dispose();
}

function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}
