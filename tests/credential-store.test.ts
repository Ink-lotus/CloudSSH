import { describe, expect, it } from 'vitest';
import { computeRecentList, encryptCredentials, decryptCredentials, type RecentConnection } from '../frontend/src/credential-store';

const SECRET = 'https://example.test:cloudssh';

function rec(id: string): RecentConnection {
  return { id, host: id, port: 22, username: 'u', authMethod: 'password', timestamp: 0 };
}

describe('最近连接列表计算', () => {
  it('新记录插入头部', () => {
    const list = computeRecentList([rec('a')], rec('b'));
    expect(list.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('相同 id 去重后置顶', () => {
    const list = computeRecentList([rec('a'), rec('b')], rec('a'));
    expect(list.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('最多保留 5 条', () => {
    const existing = ['a', 'b', 'c', 'd', 'e'].map(rec);
    const list = computeRecentList(existing, rec('f'));
    expect(list.map((r) => r.id)).toEqual(['f', 'a', 'b', 'c', 'd']);
  });
});

describe('凭据加解密往返', () => {
  it('加密后可解密出原始字段', async () => {
    const stored = await encryptCredentials(
      { host: 'h', port: '22', username: 'u', password: 'p', authMethod: 'password' },
      SECRET,
    );
    const back = await decryptCredentials(stored, SECRET);
    expect(back).toMatchObject({ host: 'h', username: 'u', password: 'p' });
  });

  it('密钥不同则解密失败返回 null', async () => {
    const stored = await encryptCredentials({ host: 'h', port: '22', username: 'u', password: 'p', authMethod: 'password' }, SECRET);
    expect(await decryptCredentials(stored, 'other:cloudssh')).toBeNull();
  });
});
