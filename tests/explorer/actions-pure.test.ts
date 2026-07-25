import { describe, it, expect } from 'vitest';
import { joinPath, buildOpenCommand, parseFindOutput } from '../../frontend/src/explorer/explorer-actions';

describe('joinPath', () => {
  it('根目录拼接不产生双斜杠', () => {
    expect(joinPath('/', 'a.txt')).toBe('/a.txt');
  });
  it('普通目录拼接', () => {
    expect(joinPath('/home/user', 'docs')).toBe('/home/user/docs');
  });
});

describe('buildOpenCommand', () => {
  it('nano 命令，单引号包裹路径', () => {
    expect(buildOpenCommand('nano', '/home/user/a.txt')).toBe("nano '/home/user/a.txt'");
  });
  it('路径含单引号时转义', () => {
    expect(buildOpenCommand('vim', "/tmp/it's.txt")).toBe("vim '/tmp/it'\\''s.txt'");
  });
});

describe('parseFindOutput', () => {
  it('把 find 输出解析为路径/名称/目录', () => {
    const out = '/home/user/a.txt\n/home/user/sub/b.log\n';
    expect(parseFindOutput(out)).toEqual([
      { path: '/home/user/a.txt', name: 'a.txt', dir: '/home/user' },
      { path: '/home/user/sub/b.log', name: 'b.log', dir: '/home/user/sub' },
    ]);
  });
  it('忽略空行', () => {
    expect(parseFindOutput('\n\n')).toEqual([]);
  });
});
