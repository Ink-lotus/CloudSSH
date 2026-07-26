import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { enUS } from '../frontend/src/i18n/locales/en-US';
import { zhCN } from '../frontend/src/i18n/locales/zh-CN';
import { getAlternateLocale, normalizeLocale, resolveLocale, resolveAutoLocale, setLocale, t } from '../frontend/src/i18n';
import { getResponseLanguageInstruction } from '../src/worker/agent/prompt';

describe('国际化核心', () => {
  it('中英文语言包的键完全一致', () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it('按 URL、持久化设置、浏览器语言的优先级解析语言', () => {
    expect(resolveLocale({
      urlLocale: 'en',
      storedLocale: 'zh-CN',
      browserLocales: ['zh-CN'],
    })).toBe('en-US');
    expect(resolveLocale({ storedLocale: 'en_US', browserLocales: ['zh-CN'] })).toBe('en-US');
    expect(resolveLocale({ browserLocales: ['fr-FR', 'en-GB'] })).toBe('en-US');
    expect(resolveLocale({ browserLocales: ['fr-FR'] })).toBe('zh-CN');
  });

  it('归一化受支持的语言并拒绝未知语言', () => {
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(normalizeLocale('en-GB')).toBe('en-US');
    expect(normalizeLocale('ja-JP')).toBeNull();
  });

  it('语言按钮始终指向另一种语言', () => {
    expect(getAlternateLocale('zh-CN')).toBe('en-US');
    expect(getAlternateLocale('en-US')).toBe('zh-CN');
  });

  it('切换词典并插值参数', () => {
    setLocale('en-US', { persist: false });
    expect(t('terminal.connectionClosed', { code: 1000 })).toBe('Connection closed (code=1000)');
    setLocale('zh-CN', { persist: false });
    expect(t('terminal.connectionClosed', { code: 1000 })).toBe('连接已关闭（代码=1000）');
  });

  it('自动模式匹配浏览器语言，无匹配回退英文', () => {
    expect(resolveAutoLocale(['zh-CN'])).toBe('zh-CN');
    expect(resolveAutoLocale(['en-GB'])).toBe('en-US');
    expect(resolveAutoLocale(['ja-JP', 'en'])).toBe('en-US');
    expect(resolveAutoLocale(['fr-FR'])).toBe('en-US');
    expect(resolveAutoLocale([])).toBe('en-US');
  });
});

describe('Agent 响应语言', () => {
  it('根据界面语言生成明确且不改变命令内容的语言指令', () => {
    expect(getResponseLanguageInstruction('en-US')).toContain('Respond in English');
    expect(getResponseLanguageInstruction('zh-CN')).toContain('使用简体中文回答');
    expect(getResponseLanguageInstruction('en-US')).toContain('commands');
  });
});

describe('语言切换入口', () => {
  it('语言切换已迁入设置 App，旧登录页与页面级切换器已移除', () => {
    const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
    expect(html).not.toContain('data-language-switcher');
    expect(html).not.toContain('id="auth-section"');
  });
});
