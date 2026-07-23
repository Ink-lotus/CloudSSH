import { describe, it, expect } from 'vitest';
import { detectMode, resolveMode } from '../../frontend/src/shell/mode';

describe('detectMode', () => {
  it('触屏(coarse)且窄屏 → mobile', () => {
    expect(detectMode({ pointerCoarse: true, hoverNone: true, width: 400 })).toBe('mobile');
  });
  it('触屏但宽屏（平板横屏）→ desktop', () => {
    expect(detectMode({ pointerCoarse: true, hoverNone: true, width: 1024 })).toBe('desktop');
  });
  it('鼠标(fine)窄窗口 → desktop（桌面缩小窗口不误判）', () => {
    expect(detectMode({ pointerCoarse: false, hoverNone: false, width: 500 })).toBe('desktop');
  });
  it('阈值可配置', () => {
    expect(detectMode({ pointerCoarse: true, hoverNone: false, width: 700 }, 600)).toBe('desktop');
  });
});

describe('resolveMode', () => {
  it('有手动覆盖时覆盖优先', () => {
    expect(resolveMode('desktop', 'mobile')).toBe('desktop');
  });
  it('无覆盖时用检测结果', () => {
    expect(resolveMode(null, 'mobile')).toBe('mobile');
  });
});
