import { describe, it, expect } from 'vitest';
import { tabTitle, nextActiveAfterClose } from '../../frontend/src/explorer/tab-manager';

describe('tabTitle', () => {
  it('根目录显示 服务器名:/', () => {
    expect(tabTitle('开发机', '/')).toBe('开发机:/');
  });
  it('深层目录取末段', () => {
    expect(tabTitle('生产机', '/var/log/nginx')).toBe('生产机:nginx');
  });
});

describe('nextActiveAfterClose', () => {
  it('关闭非当前标签，active 不变', () => {
    expect(nextActiveAfterClose(['a', 'b', 'c'], 'a', 'b')).toBe('b');
  });
  it('关闭当前标签，选原位置的后一个', () => {
    expect(nextActiveAfterClose(['a', 'b', 'c'], 'b', 'b')).toBe('c');
  });
  it('关闭最后一个当前标签，选前一个', () => {
    expect(nextActiveAfterClose(['a', 'b', 'c'], 'c', 'c')).toBe('b');
  });
  it('关闭唯一标签，返回 null', () => {
    expect(nextActiveAfterClose(['a'], 'a', 'a')).toBeNull();
  });
});
