import { describe, expect, it } from 'vitest';
import { nextDots } from '../frontend/src/terminal-overlay';

describe('循环点动画', () => {
  it('按 空→.→..→...→空 循环', () => {
    expect(nextDots('')).toBe('.');
    expect(nextDots('.')).toBe('..');
    expect(nextDots('..')).toBe('...');
    expect(nextDots('...')).toBe('');
  });
});
