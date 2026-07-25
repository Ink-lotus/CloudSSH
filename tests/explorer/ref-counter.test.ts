import { describe, it, expect } from 'vitest';
import { ConnectionRefCounter } from '../../frontend/src/explorer/connection-pool';

describe('ConnectionRefCounter', () => {
  it('acquire 递增、release 递减，不为负', () => {
    const rc = new ConnectionRefCounter();
    expect(rc.acquire(1)).toBe(1);
    expect(rc.acquire(1)).toBe(2);
    expect(rc.count(1)).toBe(2);
    expect(rc.release(1)).toBe(1);
    expect(rc.release(1)).toBe(0);
    expect(rc.release(1)).toBe(0);
  });

  it('不同服务器独立计数', () => {
    const rc = new ConnectionRefCounter();
    rc.acquire(1); rc.acquire(2); rc.acquire(2);
    expect(rc.count(1)).toBe(1);
    expect(rc.count(2)).toBe(2);
  });
});
