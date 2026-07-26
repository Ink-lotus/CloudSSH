// 多服务器 SFTP 连接池 —— 隐藏 SSHTerminal + SFTPConnection + 引用计数

import { loadKnownFingerprint, SSHTerminal, type SSHConnectionConfig } from '../terminal';
import { SFTPConnection } from './sftp-connection';
import { connectServerWs } from '../shared/server-data';
import type {
  ExplorerConnectionKey,
  ExplorerConnectionRequest,
  ExplorerTarget,
} from './connection-target';

export interface ExplorerTerminal {
  setSessionReadyHandler(handler: () => void): void;
  setSessionClosedHandler(handler: (event: CloseEvent) => void): void;
  connect(config: SSHConnectionConfig): Promise<void>;
  connectWithWebSocket(ws: WebSocket, hostInfo?: { host: string; port: number }): void;
  getSFTPWebSocketUrl(): string | null;
  disconnect(): void;
  dispose(): void;
}

export interface ExplorerSSHDependencies {
  connectServerWs(serverId: number): Promise<string>;
  loadKnownFingerprint(host: string, port: number): Promise<string | null>;
  createWebSocket(url: string): WebSocket;
}

const defaultSSHDependencies: ExplorerSSHDependencies = {
  connectServerWs,
  loadKnownFingerprint,
  createWebSocket: (url) => new WebSocket(url),
};

/** 建立资源管理器的 SSH 主连接，并等待 shell session ready。 */
export async function connectExplorerSSH(
  request: ExplorerConnectionRequest,
  terminal: ExplorerTerminal,
  deps: ExplorerSSHDependencies = defaultSSHDependencies,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new Error('EXPLORER_CONNECT_ABORTED');
  let abandonReady!: () => void;
  const ready = new Promise<void>((resolve, reject) => {
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
    const onAbort = (): void => { cleanup(); reject(new Error('EXPLORER_CONNECT_ABORTED')); };
    abandonReady = (): void => { cleanup(); resolve(); };
    terminal.setSessionReadyHandler(() => { cleanup(); resolve(); });
    terminal.setSessionClosedHandler(() => { cleanup(); reject(new Error('SSH_SESSION_CLOSED')); });
    signal?.addEventListener('abort', onAbort, { once: true });
  });

  try {
    if (request.connect.source === 'saved') {
      const wsUrl = await deps.connectServerWs(request.connect.serverId);
      const ws = deps.createWebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      terminal.connectWithWebSocket(ws, {
        host: request.target.host,
        port: request.target.port,
      });
    } else {
      const config = request.connect.config;
      const knownFingerprint = await deps.loadKnownFingerprint(config.host, config.port);
      const expectedFingerprint = knownFingerprint || config.expectedFingerprint;
      await terminal.connect({
        ...config,
        ...(expectedFingerprint ? { expectedFingerprint } : {}),
      });
    }
  } catch (error) {
    abandonReady();
    throw error;
  }

  await ready;
}

export interface SFTPAttachWaitOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
}

const SFTP_ATTACH_INTERVAL_MS = 50;
const SFTP_ATTACH_TIMEOUT_MS = 5000;

/** 等待主连接下发 sftp_attach URL；始终有超时且取消后不遗留 timer。 */
export function waitForSFTPAttachUrl(
  getUrl: () => string | null,
  options: SFTPAttachWaitOptions = {},
): Promise<string> {
  if (options.signal?.aborted) return Promise.reject(new Error('SFTP_ATTACH_ABORTED'));
  const existing = getUrl();
  if (existing) return Promise.resolve(existing);

  const intervalMs = options.intervalMs ?? SFTP_ATTACH_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? SFTP_ATTACH_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (url: string): void => { cleanup(); resolve(url); };
    const fail = (code: string): void => { cleanup(); reject(new Error(code)); };
    const onAbort = (): void => fail('SFTP_ATTACH_ABORTED');
    const poll = (): void => {
      if (options.signal?.aborted) { onAbort(); return; }
      const url = getUrl();
      if (url) { finish(url); return; }
      const elapsed = Date.now() - startedAt;
      if (elapsed >= timeoutMs) { fail('SFTP_ATTACH_TIMEOUT'); return; }
      timer = setTimeout(poll, Math.min(intervalMs, timeoutMs - elapsed));
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(poll, Math.min(intervalMs, timeoutMs));
  });
}

/** 引用计数纯逻辑（可单测） */
export class ConnectionRefCounter {
  private counts = new Map<ExplorerConnectionKey, number>();
  acquire(key: ExplorerConnectionKey): number {
    const n = (this.counts.get(key) || 0) + 1;
    this.counts.set(key, n);
    return n;
  }
  release(key: ExplorerConnectionKey): number {
    const n = Math.max(0, (this.counts.get(key) || 0) - 1);
    this.counts.set(key, n);
    return n;
  }
  count(key: ExplorerConnectionKey): number { return this.counts.get(key) || 0; }
}

export interface PooledConnection {
  request: ExplorerConnectionRequest;
  target: ExplorerTarget;
  terminal: SSHTerminal;
  connection: SFTPConnection;
  mountEl: HTMLElement;
}

export interface ConnectionPoolDependencies {
  createHiddenHost(): HTMLElement;
  createMount(host: HTMLElement, id: string): HTMLElement;
  createTerminal(mountId: string): ExplorerTerminal & { mount(): void };
  connectSSH(
    request: ExplorerConnectionRequest,
    terminal: ExplorerTerminal,
    signal?: AbortSignal,
  ): Promise<void>;
  waitForAttachUrl(
    getUrl: () => string | null,
    options?: SFTPAttachWaitOptions,
  ): Promise<string>;
  createSFTPConnection(getUrl: () => string | null): SFTPConnection;
}

const defaultPoolDependencies: ConnectionPoolDependencies = {
  createHiddenHost: () => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;';
    document.body.appendChild(host);
    return host;
  },
  createMount: (host, id) => {
    const mount = document.createElement('div');
    mount.id = id;
    mount.style.cssText = 'width:400px;height:300px;';
    host.appendChild(mount);
    return mount;
  },
  createTerminal: (mountId) => new SSHTerminal(mountId),
  connectSSH: (request, terminal, signal) => connectExplorerSSH(
    request, terminal, defaultSSHDependencies, signal,
  ),
  waitForAttachUrl: waitForSFTPAttachUrl,
  createSFTPConnection: (getUrl) => new SFTPConnection(getUrl),
};

export class ConnectionPool {
  private pool = new Map<ExplorerConnectionKey, PooledConnection>();
  private refs = new ConnectionRefCounter();
  private changeCbs = new Set<() => void>();
  private hiddenHost: HTMLElement;
  private connecting = new Map<ExplorerConnectionKey, Promise<SFTPConnection>>();
  private mountSeq = 0;

  constructor(private deps: ConnectionPoolDependencies = defaultPoolDependencies) {
    this.hiddenHost = deps.createHiddenHost();
  }

  connect(request: ExplorerConnectionRequest, signal?: AbortSignal): Promise<SFTPConnection> {
    const key = request.target.key;
    const existing = this.pool.get(key);
    if (existing) return Promise.resolve(existing.connection);
    const inflight = this.connecting.get(key);
    if (inflight) return inflight;

    const p = this.doConnect(request, signal).finally(() => this.connecting.delete(key));
    this.connecting.set(key, p);
    return p;
  }

  private async doConnect(
    request: ExplorerConnectionRequest,
    signal?: AbortSignal,
  ): Promise<SFTPConnection> {
    const { target } = request;
    const mountEl = this.deps.createMount(this.hiddenHost, `explorer-conn-${++this.mountSeq}`);
    const terminal = this.deps.createTerminal(mountEl.id);
    terminal.mount();
    let connection: SFTPConnection | null = null;

    try {
      if (signal?.aborted) throw new Error('SFTP_ATTACH_ABORTED');
      await this.deps.connectSSH(request, terminal, signal);
      const attachUrl = await this.deps.waitForAttachUrl(
        () => terminal.getSFTPWebSocketUrl(),
        { signal },
      );

      connection = this.deps.createSFTPConnection(() => attachUrl);
      await new Promise<void>((resolve, reject) => {
        connection!.connect({
          onReady: () => resolve(),
          onError: (error) => reject(new Error(error)),
          onDisconnect: () => this.notify(),
        });
      });

      this.pool.set(target.key, {
        request,
        target,
        terminal: terminal as SSHTerminal,
        connection,
        mountEl,
      });
      this.notify();
      return connection;
    } catch (error) {
      connection?.dispose();
      terminal.disconnect();
      terminal.dispose();
      mountEl.remove();
      throw error;
    }
  }

  acquire(connectionKey: ExplorerConnectionKey): void { this.refs.acquire(connectionKey); }
  release(connectionKey: ExplorerConnectionKey): number { return this.refs.release(connectionKey); }
  refCount(connectionKey: ExplorerConnectionKey): number { return this.refs.count(connectionKey); }

  get(connectionKey: ExplorerConnectionKey): SFTPConnection | null {
    return this.pool.get(connectionKey)?.connection ?? null;
  }
  getRequest(connectionKey: ExplorerConnectionKey): ExplorerConnectionRequest | null {
    return this.pool.get(connectionKey)?.request ?? null;
  }
  getTarget(connectionKey: ExplorerConnectionKey): ExplorerTarget | null {
    return this.pool.get(connectionKey)?.target ?? null;
  }
  getAll(): PooledConnection[] { return [...this.pool.values()]; }
  isConnected(connectionKey: ExplorerConnectionKey): boolean { return this.pool.has(connectionKey); }

  disconnect(connectionKey: ExplorerConnectionKey): void {
    const p = this.pool.get(connectionKey);
    if (!p) return;
    p.connection.dispose();
    p.terminal.disconnect();
    p.terminal.dispose();
    p.mountEl.remove();
    this.pool.delete(connectionKey);
    this.notify();
  }

  disposeAll(): void {
    [...this.pool.keys()].forEach((key) => this.disconnect(key));
    this.hiddenHost.remove();
    this.changeCbs.clear();
  }

  onChange(cb: () => void): () => void {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }
  private notify(): void { this.changeCbs.forEach((cb) => cb()); }
}
