import { describe, expect, it, vi } from 'vitest';
import {
  openExplorerTerminal,
  sendInitialCommandOnReady,
  type ExplorerTerminalOpenDependencies,
} from '../../frontend/src/apps/terminal-app';
import {
  requestFromDirectConfig,
  requestFromSavedServer,
} from '../../frontend/src/explorer/connection-target';
import type { SSHConnectionConfig } from '../../frontend/src/terminal';

function dependencies(
  overrides: Partial<ExplorerTerminalOpenDependencies> = {},
): ExplorerTerminalOpenDependencies {
  return {
    connectServerWs: async () => 'wss://example.test/token',
    loadKnownFingerprint: async () => null,
    openSavedTerminal: () => undefined,
    createDirectTerminal: () => ({
      terminal: { connect: async () => undefined },
      close: () => undefined,
    }),
    ...overrides,
  };
}

describe('openExplorerTerminal', () => {
  it('loads a fresh token and opens a saved terminal', async () => {
    const request = requestFromSavedServer({
      id: 7, name: '开发机', host: '10.0.0.2', port: 2222, username: 'root',
    });
    const loadedIds: number[] = [];
    const opened: unknown[] = [];

    await openExplorerTerminal(request, "nano '/tmp/a'", dependencies({
      connectServerWs: async (id) => { loadedIds.push(id); return 'wss://example.test/fresh'; },
      openSavedTerminal: (options) => { opened.push(options); },
    }));

    expect(loadedIds).toEqual([7]);
    expect(opened).toEqual([{
      wsUrl: 'wss://example.test/fresh',
      name: "开发机: nano '/tmp/a'",
      hostInfo: { host: '10.0.0.2', port: 2222 },
      initialCommand: "nano '/tmp/a'",
    }]);
  });

  it('opens a direct terminal from the in-memory config with known fingerprint', async () => {
    const request = requestFromDirectConfig({
      host: 'ssh.example.com', port: 22, username: 'alice',
      authMethod: 'password', password: 'secret-password',
    }, 'abc');
    const created: unknown[] = [];
    const connected: SSHConnectionConfig[] = [];
    let savedLoads = 0;

    await openExplorerTerminal(request, "vim '/tmp/a'", dependencies({
      connectServerWs: async () => { savedLoads += 1; return 'unused'; },
      loadKnownFingerprint: async () => 'SHA256:known',
      createDirectTerminal: (options) => {
        created.push(options);
        return {
          terminal: { connect: async (config) => { connected.push(config); } },
          close: () => undefined,
        };
      },
    }));

    expect(savedLoads).toBe(0);
    expect(created).toEqual([{
      name: "alice@ssh.example.com: vim '/tmp/a'",
      hostInfo: { host: 'ssh.example.com', port: 22 },
      initialCommand: "vim '/tmp/a'",
    }]);
    expect(connected).toEqual([{
      host: 'ssh.example.com', port: 22, username: 'alice',
      authMethod: 'password', password: 'secret-password',
      expectedFingerprint: 'SHA256:known',
    }]);
  });

  it('closes a failed direct window and redacts credentials from the error', async () => {
    const request = requestFromDirectConfig({
      host: 'ssh.example.com', port: 22, username: 'alice',
      authMethod: 'publickey', privateKey: 'SECRET-PRIVATE-KEY',
    }, 'abc');
    let closed = false;
    const pending = openExplorerTerminal(request, 'nano file', dependencies({
      createDirectTerminal: () => ({
        terminal: {
          connect: async () => { throw new Error('rejected SECRET-PRIVATE-KEY'); },
        },
        close: () => { closed = true; },
      }),
    }));

    await expect(pending).rejects.toThrow('rejected [redacted]');
    expect(closed).toBe(true);
  });
});

describe('sendInitialCommandOnReady', () => {
  it('does not send until ready and then sends the command with a newline', () => {
    vi.useFakeTimers();
    let ready: (() => void) | null = null;
    const sent: string[] = [];
    sendInitialCommandOnReady(
      (handler) => { ready = handler; },
      (message) => { sent.push(message); },
      "nano '/tmp/a'",
    );

    expect(sent).toEqual([]);
    (ready as unknown as () => void)();
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(sent).toEqual(["nano '/tmp/a'\n"]);
    vi.useRealTimers();
  });
});
