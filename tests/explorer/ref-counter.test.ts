import { describe, it, expect } from 'vitest';
import { ConnectionRefCounter } from '../../frontend/src/explorer/connection-pool';

describe('ConnectionRefCounter', () => {
  it('acquire 递增、release 递减，不为负', () => {
    const rc = new ConnectionRefCounter();
    expect(rc.acquire('saved:1')).toBe(1);
    expect(rc.acquire('saved:1')).toBe(2);
    expect(rc.count('saved:1')).toBe(2);
    expect(rc.release('saved:1')).toBe(1);
    expect(rc.release('saved:1')).toBe(0);
    expect(rc.release('saved:1')).toBe(0);
  });

  it('不同连接 key 独立计数', () => {
    const rc = new ConnectionRefCounter();
    rc.acquire('saved:1'); rc.acquire('direct:abc'); rc.acquire('direct:abc');
    expect(rc.count('saved:1')).toBe(1);
    expect(rc.count('direct:abc')).toBe(2);
  });
});
