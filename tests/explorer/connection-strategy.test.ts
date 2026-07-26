import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectionPool,
  connectExplorerSSH,
  waitForSFTPAttachUrl,
  type ConnectionPoolDependencies,
  type ExplorerSSHDependencies,
  type ExplorerTerminal,
} from '../../frontend/src/explorer/connection-pool';
import type { SFTPConnection, SFTPConnectionCallbacks } from '../../frontend/src/explorer/sftp-connection';
import {
  requestFromDirectConfig,
  requestFromSavedServer,
} from '../../frontend/src/explorer/connection-target';
import type { SSHConnectionConfig } from '../../frontend/src/terminal';

class FakeTerminal implements ExplorerTerminal {
  connectedConfig: SSHConnectionConfig | null = null;
  connectedSocket: WebSocket | null = null;
  hostInfo: { host: string; port: number } | undefined;
  private ready: (() => void) | null = null;
  private closed: ((event: CloseEvent) => void) | null = null;

  setSessionReadyHandler(handler: () => void): void { this.ready = handler; }
  setSessionClosedHandler(handler: (event: CloseEvent) => void): void { this.closed = handler; }
  async connect(config: SSHConnectionConfig): Promise<void> {
    this.connectedConfig = config;
    this.ready?.();
  }
  connectWithWebSocket(ws: WebSocket, hostInfo?: { host: string; port: number }): void {
    this.connectedSocket = ws;
    this.hostInfo = hostInfo;
    this.ready?.();
  }
  getSFTPWebSocketUrl(): string | null { return null; }
  disconnect(): void { this.closed?.(new CloseEvent('close')); }
  dispose(): void {}
}

function dependencies(overrides: Partial<ExplorerSSHDependencies> = {}): ExplorerSSHDependencies {
  return {
    connectServerWs: async () => 'wss://example.test/saved',
    loadKnownFingerprint: async () => null,
    createWebSocket: (url) => ({ url, binaryType: '' } as unknown as WebSocket),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('connectExplorerSSH', () => {
  it('uses a one-time WebSocket for a saved server', async () => {
    const request = requestFromSavedServer({
      id: 7, name: '开发机', host: '10.0.0.2', port: 2222, username: 'root',
    });
    const terminal = new FakeTerminal();
    const requestedIds: number[] = [];
    const createdUrls: string[] = [];
    let fingerprintLoads = 0;

    await connectExplorerSSH(request, terminal, dependencies({
      connectServerWs: async (id) => { requestedIds.push(id); return 'wss://example.test/token'; },
      loadKnownFingerprint: async () => { fingerprintLoads += 1; return null; },
      createWebSocket: (url) => {
        createdUrls.push(url);
        return { url, binaryType: '' } as unknown as WebSocket;
      },
    }));

    expect(requestedIds).toEqual([7]);
    expect(createdUrls).toEqual(['wss://example.test/token']);
    expect(terminal.connectedSocket).not.toBeNull();
    expect(terminal.hostInfo).toEqual({ host: '10.0.0.2', port: 2222 });
    expect(terminal.connectedConfig).toBeNull();
    expect(fingerprintLoads).toBe(0);
  });

  it('loads and merges the known fingerprint for a direct connection', async () => {
    const request = requestFromDirectConfig({
      host: 'ssh.example.com', port: 22, username: 'alice',
      authMethod: 'password', password: 'secret-password',
    }, 'abc');
    const terminal = new FakeTerminal();
    const fingerprintHosts: Array<[string, number]> = [];
    let savedLoads = 0;

    await connectExplorerSSH(request, terminal, dependencies({
      connectServerWs: async () => { savedLoads += 1; return 'unused'; },
      loadKnownFingerprint: async (host, port) => {
        fingerprintHosts.push([host, port]);
        return 'SHA256:known';
      },
    }));

    expect(fingerprintHosts).toEqual([['ssh.example.com', 22]]);
    expect(savedLoads).toBe(0);
    expect(terminal.connectedSocket).toBeNull();
    expect(terminal.connectedConfig).toEqual({
      host: 'ssh.example.com', port: 22, username: 'alice',
      authMethod: 'password', password: 'secret-password',
      expectedFingerprint: 'SHA256:known',
    });
  });

  it('does not add direct credentials to the target, key, or propagated errors', async () => {
    const request = requestFromDirectConfig({
      host: 'ssh.example.com', port: 22, username: 'alice',
      authMethod: 'publickey', privateKey: 'SECRET-PRIVATE-KEY',
    }, 'safe-id');
    const terminal = new FakeTerminal();
    terminal.connect = async () => { throw new Error('authentication failed'); };

    const error = await connectExplorerSSH(request, terminal, dependencies())
      .then(() => null, (reason: unknown) => reason);

    expect(request.target.key).toBe('direct:safe-id');
    expect(JSON.stringify(request.target)).not.toContain('SECRET-PRIVATE-KEY');
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('authentication failed');
    expect((error as Error).message).not.toContain('SECRET-PRIVATE-KEY');

    // Pool cleanup disconnects the terminal after connect() rejects.
    terminal.disconnect();
    await Promise.resolve();
  });

  it('stops waiting for session ready when aborted', async () => {
    const request = requestFromSavedServer({
      id: 7, name: '开发机', host: '10.0.0.2', port: 22, username: 'root',
    });
    const terminal = new FakeTerminal();
    terminal.connectWithWebSocket = (ws, hostInfo) => {
      terminal.connectedSocket = ws;
      terminal.hostInfo = hostInfo;
    };
    const controller = new AbortController();
    const pending = connectExplorerSSH(
      request, terminal, dependencies(), controller.signal,
    );

    controller.abort();

    await expect(pending).rejects.toThrow('EXPLORER_CONNECT_ABORTED');
  });

  it('stops immediately when aborted while a direct connection dependency is pending', async () => {
    const request = requestFromDirectConfig({
      host: 'ssh.example.com', port: 22, username: 'alice', password: 'secret',
    }, 'abort-pending-dependency');
    const terminal = new FakeTerminal();
    const controller = new AbortController();
    const pending = connectExplorerSSH(request, terminal, dependencies({
      loadKnownFingerprint: () => new Promise<string | null>(() => {}),
    }), controller.signal);

    controller.abort();

    await expect(Promise.race([
      pending,
      new Promise((_, reject) => setTimeout(() => reject(new Error('ABORT_NOT_IMMEDIATE')), 50)),
    ])).rejects.toThrow('EXPLORER_CONNECT_ABORTED');
  });
});

describe('waitForSFTPAttachUrl', () => {
  it('returns an existing URL without scheduling a timer', async () => {
    vi.useFakeTimers();
    await expect(waitForSFTPAttachUrl(() => 'wss://example.test/sftp'))
      .resolves.toBe('wss://example.test/sftp');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('polls until a delayed URL appears', async () => {
    vi.useFakeTimers();
    let url: string | null = null;
    setTimeout(() => { url = 'wss://example.test/sftp'; }, 30);

    const pending = waitForSFTPAttachUrl(() => url, { intervalMs: 10, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(30);

    await expect(pending).resolves.toBe('wss://example.test/sftp');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with a stable error after the timeout', async () => {
    vi.useFakeTimers();
    const pending = waitForSFTPAttachUrl(() => null, { intervalMs: 10, timeoutMs: 50 });
    const rejected = expect(pending).rejects.toThrow('SFTP_ATTACH_TIMEOUT');

    await vi.advanceTimersByTimeAsync(50);

    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops immediately when aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = waitForSFTPAttachUrl(() => null, {
      intervalMs: 10, timeoutMs: 100, signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toThrow('SFTP_ATTACH_ABORTED');

    controller.abort();

    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});

interface PoolHarness {
  deps: ConnectionPoolDependencies;
  mountRemoved: number;
  hostRemoved: number;
  terminalDisconnects: number;
  terminalDisposals: number;
  sftpDisposals: number;
  finishSSH: () => void;
  failSSH: (error: Error) => void;
  setSFTPError: (message: string | null) => void;
}

function poolHarness(): PoolHarness {
  let mountRemoved = 0;
  let hostRemoved = 0;
  let terminalDisconnects = 0;
  let terminalDisposals = 0;
  let sftpDisposals = 0;
  let resolveSSH: (() => void) | null = null;
  let rejectSSH: ((error: Error) => void) | null = null;
  let sftpError: string | null = null;
  const host = {
    style: { cssText: '' },
    appendChild: () => undefined,
    remove: () => { hostRemoved += 1; },
  } as unknown as HTMLElement;
  const mount = {
    id: '',
    style: { cssText: '' },
    remove: () => { mountRemoved += 1; },
  } as unknown as HTMLElement;
  const terminal = {
    mount: () => undefined,
    disconnect: () => { terminalDisconnects += 1; },
    dispose: () => { terminalDisposals += 1; },
    getSFTPWebSocketUrl: () => 'wss://example.test/sftp',
  } as unknown as ExplorerTerminal;
  const sftp = {
    connect: (callbacks: SFTPConnectionCallbacks) => {
      if (sftpError) callbacks.onError(sftpError);
      else callbacks.onReady();
    },
    dispose: () => { sftpDisposals += 1; },
    isReady: () => true,
  } as unknown as SFTPConnection;

  return {
    deps: {
      createHiddenHost: () => host,
      createMount: (_host, id) => { mount.id = id; return mount; },
      createTerminal: () => terminal,
      connectSSH: (_request, _terminal, signal) => new Promise<void>((resolve, reject) => {
        resolveSSH = resolve;
        rejectSSH = reject;
        const onAbort = () => reject(new Error('EXPLORER_CONNECT_ABORTED'));
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      }),
      waitForAttachUrl: async () => 'wss://example.test/sftp',
      createSFTPConnection: () => sftp,
    },
    get mountRemoved() { return mountRemoved; },
    get hostRemoved() { return hostRemoved; },
    get terminalDisconnects() { return terminalDisconnects; },
    get terminalDisposals() { return terminalDisposals; },
    get sftpDisposals() { return sftpDisposals; },
    finishSSH: () => resolveSSH?.(),
    failSSH: (error) => rejectSSH?.(error),
    setSFTPError: (message) => { sftpError = message; },
  };
}

describe('ConnectionPool cleanup', () => {
  it('releases the terminal and hidden mount when SSH fails', async () => {
    const harness = poolHarness();
    const pool = new ConnectionPool(harness.deps);
    const request = requestFromDirectConfig({
      host: 'ssh.example.com', port: 22, username: 'alice', password: 'secret',
    }, 'ssh-failure');
    const pending = pool.connect(request);

    harness.failSSH(new Error('SSH failed'));

    await expect(pending).rejects.toThrow('SSH failed');
    expect(harness.terminalDisconnects).toBe(1);
    expect(harness.terminalDisposals).toBe(1);
    expect(harness.mountRemoved).toBe(1);
    expect(pool.getAll()).toEqual([]);
  });

  it('releases both SFTP and SSH resources when SFTP initialization fails', async () => {
    const harness = poolHarness();
    harness.setSFTPError('SFTP unsupported');
    const pool = new ConnectionPool(harness.deps);
    const request = requestFromDirectConfig({
      host: 'ssh.example.com', port: 22, username: 'alice', password: 'secret',
    }, 'sftp-failure');
    const pending = pool.connect(request);

    harness.finishSSH();

    await expect(pending).rejects.toThrow('SFTP unsupported');
    expect(harness.sftpDisposals).toBe(1);
    expect(harness.terminalDisposals).toBe(1);
    expect(harness.mountRemoved).toBe(1);
  });

  it('shares one in-flight promise for concurrent connects with the same key', async () => {
    const harness = poolHarness();
    const pool = new ConnectionPool(harness.deps);
    const request = requestFromDirectConfig({
      host: 'ssh.example.com', port: 22, username: 'alice', password: 'secret',
    }, 'shared');

    const first = pool.connect(request);
    const second = pool.connect(request);
    expect(second).toBe(first);

    harness.finishSSH();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(pool.getAll()).toHaveLength(1);
  });

  it('allows a retry after a failed connect clears the in-flight entry', async () => {
    const harness = poolHarness();
    const pool = new ConnectionPool(harness.deps);
    const request = requestFromDirectConfig({
      host: 'ssh.example.com', port: 22, username: 'alice', password: 'secret',
    }, 'retry');
    const first = pool.connect(request);
    harness.failSSH(new Error('first failed'));
    await expect(first).rejects.toThrow('first failed');

    const second = pool.connect(request);
    expect(second).not.toBe(first);
    harness.finishSSH();
    await expect(second).resolves.toBeDefined();
  });

  it('drops direct request credentials when all connections are disposed', async () => {
    const harness = poolHarness();
    const pool = new ConnectionPool(harness.deps);
    const request = requestFromDirectConfig({
      host: 'ssh.example.com', port: 22, username: 'alice', password: 'secret-password',
    }, 'dispose');
    const pending = pool.connect(request);
    harness.finishSSH();
    await pending;
    expect(pool.getRequest('direct:dispose')).toBe(request);

    pool.disposeAll();

    expect(pool.getRequest('direct:dispose')).toBeNull();
    expect(pool.getAll()).toEqual([]);
    expect(harness.sftpDisposals).toBe(1);
    expect(harness.hostRemoved).toBe(1);
  });

  it('cancels and cleans an in-flight direct connection when all connections are disposed', async () => {
    const harness = poolHarness();
    const pool = new ConnectionPool(harness.deps);
    const request = requestFromDirectConfig({
      host: 'ssh.example.com', port: 22, username: 'alice', password: 'secret-password',
    }, 'pending-dispose');
    const pending = pool.connect(request);

    pool.disposeAll();

    await expect(pending).rejects.toThrow('EXPLORER_CONNECT_ABORTED');
    expect(harness.terminalDisconnects).toBe(1);
    expect(harness.terminalDisposals).toBe(1);
    expect(harness.mountRemoved).toBe(1);
    expect(harness.hostRemoved).toBe(1);
  });

  it('rejects new connections after the pool is disposed', async () => {
    const harness = poolHarness();
    const pool = new ConnectionPool(harness.deps);
    const request = requestFromDirectConfig({
      host: 'ssh.example.com', port: 22, username: 'alice', password: 'secret-password',
    }, 'after-dispose');

    pool.disposeAll();

    await expect(pool.connect(request)).rejects.toThrow('CONNECTION_POOL_DISPOSED');
  });

});
