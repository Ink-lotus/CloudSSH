import type { SSHConnectionConfig } from '../terminal';

export interface ConnectionDraft {
  host: string;
  port: string;
  username: string;
  authMethod: 'password' | 'publickey';
  password: string;
  privateKey: string;
  locationHint?: string;
}

export type ConnectionValidationError =
  | 'host_required'
  | 'username_required'
  | 'invalid_port'
  | 'password_required'
  | 'private_key_required';

export type ConnectionValidationResult =
  | { ok: true; config: SSHConnectionConfig }
  | {
      ok: false;
      error: ConnectionValidationError;
      field: 'host' | 'port' | 'username' | 'password' | 'privateKey';
    };

export function connectionDraftAfterFailure(
  draft: ConnectionDraft,
  remembered: boolean,
): ConnectionDraft {
  if (remembered) return draft;
  return { ...draft, password: '', privateKey: '' };
}

export function parseConnectionDraft(draft: ConnectionDraft): ConnectionValidationResult {
  const rawHost = draft.host.trim();
  const host = rawHost.startsWith('[') && rawHost.endsWith(']')
    ? rawHost.slice(1, -1)
    : rawHost;
  if (!host) return { ok: false, error: 'host_required', field: 'host' };

  const rawPort = draft.port.trim();
  const port = rawPort ? Number(rawPort) : 22;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'invalid_port', field: 'port' };
  }

  const username = draft.username.trim();
  if (!username) return { ok: false, error: 'username_required', field: 'username' };

  const base = { host, port, username };
  const locationHint = draft.locationHint?.trim();
  if (draft.authMethod === 'password') {
    if (!draft.password) {
      return { ok: false, error: 'password_required', field: 'password' };
    }
    return {
      ok: true,
      config: {
        ...base,
        authMethod: 'password',
        password: draft.password,
        ...(locationHint ? { locationHint } : {}),
      },
    };
  }

  if (!draft.privateKey.trim()) {
    return { ok: false, error: 'private_key_required', field: 'privateKey' };
  }
  return {
    ok: true,
    config: {
      ...base,
      authMethod: 'publickey',
      privateKey: draft.privateKey,
      ...(locationHint ? { locationHint } : {}),
    },
  };
}
