import { describe, it, expect } from 'vitest';
import { ExplorerState } from '../../frontend/src/explorer/explorer-state';
import type { SFTPFileEntry } from '../../frontend/src/explorer/sftp-connection';

function entry(name: string, over: Partial<SFTPFileEntry> = {}): SFTPFileEntry {
  return {
    name, type: 'file', size: 0, sizeFormatted: '0 B',
    permissions: '-rw-r--r--', permissionsRaw: 0o644, modifiedTime: 0,
    isDir: false, isLink: false, ...over,
  };
}

describe('ExplorerState 选择', () => {
  it('single 清除其他选中并设锚点', () => {
    const s = new ExplorerState('t1', 1);
    s.setFiles([entry('a'), entry('b'), entry('c')]);
    s.select('a', 'single');
    s.select('b', 'single');
    expect([...s.selected]).toEqual(['b']);
  });
  it('toggle 增删', () => {
    const s = new ExplorerState('t1', 1);
    s.setFiles([entry('a'), entry('b')]);
    s.select('a', 'toggle');
    s.select('b', 'toggle');
    s.select('a', 'toggle');
    expect([...s.selected]).toEqual(['b']);
  });
  it('range 从锚点到目标（按可见顺序）', () => {
    const s = new ExplorerState('t1', 1);
    s.setFiles([entry('a'), entry('b'), entry('c'), entry('d')]);
    s.select('b', 'single');       // 锚点 b
    s.select('d', 'range');        // b..d
    expect([...s.selected].sort()).toEqual(['b', 'c', 'd']);
  });
});

describe('ExplorerState 排序', () => {
  it('文件夹优先，名称升序', () => {
    const s = new ExplorerState('t1', 1);
    s.setFiles([entry('z.txt'), entry('docs', { isDir: true }), entry('a.txt')]);
    expect(s.visibleFiles().map(f => f.name)).toEqual(['docs', 'a.txt', 'z.txt']);
  });
  it('toggleSort 同列反转，文件夹仍优先', () => {
    const s = new ExplorerState('t1', 1);
    s.setFiles([entry('a.txt'), entry('b.txt'), entry('d', { isDir: true })]);
    s.toggleSort('name'); // name 已是默认升序 → 变降序
    expect(s.visibleFiles().map(f => f.name)).toEqual(['d', 'b.txt', 'a.txt']);
  });
  it('按大小排序', () => {
    const s = new ExplorerState('t1', 1);
    s.setFiles([entry('a', { size: 30 }), entry('b', { size: 10 }), entry('c', { size: 20 })]);
    s.toggleSort('size');
    expect(s.visibleFiles().map(f => f.name)).toEqual(['b', 'c', 'a']);
  });
  it('searchQuery 过滤（大小写不敏感）', () => {
    const s = new ExplorerState('t1', 1);
    s.setFiles([entry('README.md'), entry('config.yml'), entry('readme.txt')]);
    s.searchQuery = 'readme';
    expect(s.visibleFiles().map(f => f.name).sort()).toEqual(['README.md', 'readme.txt']);
  });
});

describe('ExplorerState 历史', () => {
  it('pushCurrent / stepBack / stepForward', () => {
    const s = new ExplorerState('t1', 1); // currentPath = '/'
    s.pushCurrent('/home');
    s.pushCurrent('/home/user');
    expect(s.currentPath).toBe('/home/user');
    expect(s.stepBack()).toBe('/home');
    expect(s.stepBack()).toBe('/');
    expect(s.stepBack()).toBeNull();
    expect(s.stepForward()).toBe('/home');
    expect(s.canGoForward()).toBe(true);
  });
  it('pushCurrent 清空前进栈', () => {
    const s = new ExplorerState('t1', 1);
    s.pushCurrent('/a');
    s.stepBack();              // 回到 /
    s.pushCurrent('/b');       // 新导航
    expect(s.canGoForward()).toBe(false);
  });
});
