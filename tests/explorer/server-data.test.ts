import { describe, it, expect } from 'vitest';
import { toSavedServer } from '../../frontend/src/shared/server-data';

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
