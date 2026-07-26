import { describe, expect, it } from 'vitest';
import {
  connectionDraftAfterFailure,
  parseConnectionDraft,
  type ConnectionDraft,
} from '../../frontend/src/shared/connection-input';

function draft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    host: 'ssh.example.com',
    port: '22',
    username: 'alice',
    authMethod: 'password',
    password: 'secret',
    privateKey: '',
    locationHint: '',
    ...overrides,
  };
}

describe('parseConnectionDraft', () => {
  it('removes one pair of surrounding IPv6 brackets', () => {
    expect(parseConnectionDraft(draft({ host: ' [2001:db8::1] ' }))).toEqual({
      ok: true,
      config: {
        host: '2001:db8::1',
        port: 22,
        username: 'alice',
        authMethod: 'password',
        password: 'secret',
      },
    });
  });

  it('uses port 22 when the port input is blank', () => {
    const result = parseConnectionDraft(draft({ port: '   ' }));
    expect(result.ok && result.config.port).toBe(22);
  });

  it.each(['0', '65536', '22.5', 'abc'])('rejects invalid port %s', (port) => {
    expect(parseConnectionDraft(draft({ port }))).toEqual({
      ok: false,
      error: 'invalid_port',
      field: 'port',
    });
  });

  it('requires a host', () => {
    expect(parseConnectionDraft(draft({ host: '  ' }))).toEqual({
      ok: false,
      error: 'host_required',
      field: 'host',
    });
  });

  it('requires a username', () => {
    expect(parseConnectionDraft(draft({ username: '  ' }))).toEqual({
      ok: false,
      error: 'username_required',
      field: 'username',
    });
  });

  it('requires a password in password mode', () => {
    expect(parseConnectionDraft(draft({ password: '' }))).toEqual({
      ok: false,
      error: 'password_required',
      field: 'password',
    });
  });

  it('requires a private key in public-key mode', () => {
    expect(parseConnectionDraft(draft({
      authMethod: 'publickey', password: '', privateKey: '  ',
    }))).toEqual({
      ok: false,
      error: 'private_key_required',
      field: 'privateKey',
    });
  });

  it('returns only SSH connection fields and the selected credential', () => {
    const input = {
      ...draft({
        port: '2222',
        authMethod: 'publickey',
        password: 'must-not-leak',
        privateKey: 'PRIVATE KEY',
        locationHint: 'wnam',
      }),
      rememberConnection: true,
    };

    expect(parseConnectionDraft(input)).toEqual({
      ok: true,
      config: {
        host: 'ssh.example.com',
        port: 2222,
        username: 'alice',
        authMethod: 'publickey',
        privateKey: 'PRIVATE KEY',
        locationHint: 'wnam',
      },
    });
  });
});

describe('connectionDraftAfterFailure', () => {
  it('clears unremembered credentials while preserving connection identity fields', () => {
    expect(connectionDraftAfterFailure(draft({
      host: 'server.example.com', port: '2222', username: 'root',
      password: 'secret-password', privateKey: 'secret-private-key',
    }), false)).toEqual({
      host: 'server.example.com', port: '2222', username: 'root',
      authMethod: 'password', password: '', privateKey: '', locationHint: '',
    });
  });

  it('keeps credentials that the user explicitly chose to remember', () => {
    const input = draft({ password: 'secret-password' });
    expect(connectionDraftAfterFailure(input, true)).toEqual(input);
  });
});
