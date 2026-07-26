import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectExplorerSSH,
  waitForSFTPAttachUrl,
  type ExplorerSSHDependencies,
  type ExplorerTerminal,
} from '../../frontend/src/explorer/connection-pool';
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
