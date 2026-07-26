import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  AuthRequiredError,
  fetchSavedServers,
  toSavedServer,
} from '../../frontend/src/shared/server-data';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toSavedServer', () => {
  it('从 ServerConfig 提取资源管理器所需字段', () => {
    const config = {
      id: 7, user_id: 1, name: '开发机', host: '10.0.0.2', port: 2222,
      username: 'root', auth_method: 'password' as const,
      region: null, inferred_hint: null, created_at: '', updated_at: '',
    };
    expect(toSavedServer(config)).toEqual({
      id: 7, name: '开发机', host: '10.0.0.2', port: 2222, username: 'root',
    });
  });
});

describe('fetchSavedServers', () => {
  it('classifies a 401 as an expired or missing session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));

    await expect(fetchSavedServers()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('keeps non-authentication failures distinct', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));

    await expect(fetchSavedServers()).rejects.toThrow('Failed to fetch servers');
  });
});
