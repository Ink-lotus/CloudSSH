import { describe, it, expect } from 'vitest';
import { dispatchBack } from '../../frontend/src/shell/back-dispatch';

describe('dispatchBack', () => {
  it('无处理器时返回 false（未消费）', () => {
    expect(dispatchBack([])).toBe(false);
  });
  it('后注册的处理器先被询问（LIFO），消费即停', () => {
    const calls: string[] = [];
    const handlers = [
      () => { calls.push('a'); return false; },
      () => { calls.push('b'); return true; },
      () => { calls.push('c'); return false; },
    ];
    expect(dispatchBack(handlers)).toBe(true);
    expect(calls).toEqual(['c', 'b']); // c 先问返回 false，b 返回 true 停止；a 不问
  });
  it('全部不消费时返回 false', () => {
    expect(dispatchBack([() => false, () => false])).toBe(false);
  });
});
