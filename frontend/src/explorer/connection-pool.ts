// 多服务器 SFTP 连接池 —— 隐藏 SSHTerminal + SFTPConnection + 引用计数

import { SSHTerminal } from '../terminal';
import { SFTPConnection } from './sftp-connection';
import { connectServerWs } from '../shared/server-data';
import type {
  ExplorerConnectionKey,
  ExplorerConnectionRequest,
  ExplorerTarget,
} from './connection-target';

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
}

export class ConnectionPool {
  private pool = new Map<ExplorerConnectionKey, PooledConnection>();
  private refs = new ConnectionRefCounter();
  private changeCbs = new Set<() => void>();
  private hiddenHost: HTMLElement;
  private connecting = new Map<ExplorerConnectionKey, Promise<SFTPConnection>>();

  constructor() {
    this.hiddenHost = document.createElement('div');
    this.hiddenHost.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;';
    document.body.appendChild(this.hiddenHost);
  }

  connect(request: ExplorerConnectionRequest): Promise<SFTPConnection> {
    const key = request.target.key;
    const existing = this.pool.get(key);
    if (existing) return Promise.resolve(existing.connection);
    const inflight = this.connecting.get(key);
    if (inflight) return inflight;

    const p = this.doConnect(request).finally(() => this.connecting.delete(key));
    this.connecting.set(key, p);
    return p;
  }

  private async doConnect(request: ExplorerConnectionRequest): Promise<SFTPConnection> {
    if (request.connect.source !== 'saved') {
      throw new Error('Direct connections are not supported yet');
    }
    const { target } = request;
    const mountEl = document.createElement('div');
    mountEl.id = `explorer-conn-${request.connect.serverId}`;
    mountEl.style.cssText = 'width:400px;height:300px;';
    this.hiddenHost.appendChild(mountEl);
    const terminal = new SSHTerminal(mountEl.id);
    terminal.mount();

    const wsUrl = await connectServerWs(request.connect.serverId);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      terminal.setSessionReadyHandler(() => resolve());
      terminal.setSessionClosedHandler(() => reject(new Error('主连接已关闭')));
      terminal.connectWithWebSocket(ws, { host: target.host, port: target.port });
    });

    const connection = new SFTPConnection(() => terminal.getSFTPWebSocketUrl());
    await new Promise<void>((resolve, reject) => {
      connection.connect({
        onReady: () => resolve(),
        onError: (e) => reject(new Error(e)),
        onDisconnect: () => this.notify(),
      });
    });

    this.pool.set(target.key, { request, target, terminal, connection });
    this.notify();
    return connection;
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
    const serverId = p.request.connect.source === 'saved' ? p.request.connect.serverId : null;
    const el = serverId === null ? null : document.getElementById(`explorer-conn-${serverId}`);
    el?.remove();
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
