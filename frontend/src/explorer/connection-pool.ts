// 多服务器 SFTP 连接池 —— 隐藏 SSHTerminal + SFTPConnection + 引用计数

import { SSHTerminal } from '../terminal';
import { SFTPConnection } from './sftp-connection';
import { connectServerWs, type SavedServer } from '../shared/server-data';

/** 引用计数纯逻辑（可单测） */
export class ConnectionRefCounter {
  private counts = new Map<number, number>();
  acquire(id: number): number {
    const n = (this.counts.get(id) || 0) + 1;
    this.counts.set(id, n);
    return n;
  }
  release(id: number): number {
    const n = Math.max(0, (this.counts.get(id) || 0) - 1);
    this.counts.set(id, n);
    return n;
  }
  count(id: number): number { return this.counts.get(id) || 0; }
}

export interface PooledConnection {
  server: SavedServer;
  terminal: SSHTerminal;
  connection: SFTPConnection;
}

export class ConnectionPool {
  private pool = new Map<number, PooledConnection>();
  private refs = new ConnectionRefCounter();
  private changeCbs = new Set<() => void>();
  private hiddenHost: HTMLElement;
  private connecting = new Map<number, Promise<SFTPConnection>>();

  constructor() {
    this.hiddenHost = document.createElement('div');
    this.hiddenHost.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;';
    document.body.appendChild(this.hiddenHost);
  }

  connect(server: SavedServer): Promise<SFTPConnection> {
    const existing = this.pool.get(server.id);
    if (existing) return Promise.resolve(existing.connection);
    const inflight = this.connecting.get(server.id);
    if (inflight) return inflight;

    const p = this.doConnect(server).finally(() => this.connecting.delete(server.id));
    this.connecting.set(server.id, p);
    return p;
  }

  private async doConnect(server: SavedServer): Promise<SFTPConnection> {
    const mountEl = document.createElement('div');
    mountEl.id = `explorer-conn-${server.id}`;
    mountEl.style.cssText = 'width:400px;height:300px;';
    this.hiddenHost.appendChild(mountEl);
    const terminal = new SSHTerminal(mountEl.id);
    terminal.mount();

    const wsUrl = await connectServerWs(server.id);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      terminal.setSessionReadyHandler(() => resolve());
      terminal.setSessionClosedHandler(() => reject(new Error('主连接已关闭')));
      terminal.connectWithWebSocket(ws, { host: server.host, port: server.port });
    });

    const connection = new SFTPConnection(() => terminal.getSFTPWebSocketUrl());
    await new Promise<void>((resolve, reject) => {
      connection.connect({
        onReady: () => resolve(),
        onError: (e) => reject(new Error(e)),
        onDisconnect: () => this.notify(),
      });
    });

    this.pool.set(server.id, { server, terminal, connection });
    this.notify();
    return connection;
  }

  acquire(serverId: number): void { this.refs.acquire(serverId); }
  release(serverId: number): number { return this.refs.release(serverId); }
  refCount(serverId: number): number { return this.refs.count(serverId); }

  get(serverId: number): SFTPConnection | null {
    return this.pool.get(serverId)?.connection ?? null;
  }
  getServer(serverId: number): SavedServer | null {
    return this.pool.get(serverId)?.server ?? null;
  }
  getAll(): PooledConnection[] { return [...this.pool.values()]; }
  isConnected(serverId: number): boolean { return this.pool.has(serverId); }

  disconnect(serverId: number): void {
    const p = this.pool.get(serverId);
    if (!p) return;
    p.connection.dispose();
    p.terminal.disconnect();
    p.terminal.dispose();
    const el = document.getElementById(`explorer-conn-${serverId}`);
    el?.remove();
    this.pool.delete(serverId);
    this.notify();
  }

  disposeAll(): void {
    [...this.pool.keys()].forEach((id) => this.disconnect(id));
    this.hiddenHost.remove();
    this.changeCbs.clear();
  }

  onChange(cb: () => void): () => void {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }
  private notify(): void { this.changeCbs.forEach((cb) => cb()); }
}
