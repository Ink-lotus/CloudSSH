// 资源管理器业务操作 —— 导航/CRUD/复制移动/chmod/搜索/打开方式

import type { ExplorerState, SortKey } from './explorer-state';
import type { ConnectionPool } from './connection-pool';
import type { SFTPConnection } from './sftp-connection';
import type { ExplorerConnectionRequest } from './connection-target';

export interface ActionsContext {
  openInTerminal: (request: ExplorerConnectionRequest, initialCommand: string) => void;
  notify: (message: string, variant?: 'info' | 'danger') => void;
}

export interface SearchHit { path: string; name: string; dir: string; }

/** 纯路径拼接 */
export function joinPath(base: string, name: string): string {
  return base.endsWith('/') ? base + name : base + '/' + name;
}

/** 打开方式命令构造（单引号包裹并转义内部单引号） */
export function buildOpenCommand(method: 'nano' | 'vim', path: string): string {
  const safe = `'${path.replace(/'/g, `'\\''`)}'`;
  return `${method} ${safe}`;
}

/** 解析 find 输出为搜索命中列表 */
export function parseFindOutput(out: string): SearchHit[] {
  return out.split('\n').filter((l) => l.trim().length > 0).map((p) => {
    const idx = p.lastIndexOf('/');
    return {
      path: p,
      name: idx >= 0 ? p.slice(idx + 1) : p,
      dir: idx > 0 ? p.slice(0, idx) : '/',
    };
  });
}

/** 触发浏览器下载 */
function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** shell 单引号转义 */
function shq(s: string): string { return `'${s.replace(/'/g, `'\\''`)}'`; }

export class ExplorerActions {
  constructor(
    private state: ExplorerState,
    private pool: ConnectionPool,
    private ctx: ActionsContext,
  ) {}

  private conn(): SFTPConnection {
    const c = this.pool.get(this.state.connectionKey);
    if (!c) throw new Error('连接不可用');
    return c;
  }

  // ---- 导航 ----
  private async loadFiles(path: string): Promise<void> {
    this.state.loading = true; this.state.error = null; this.state.notify();
    try {
      const files = await this.conn().listDirectory(path);
      this.state.setFiles(files);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.state.error = msg;
      this.ctx.notify(msg, 'danger');
    } finally {
      this.state.loading = false; this.state.notify();
    }
  }
  async navigate(path: string): Promise<void> { this.state.pushCurrent(path); await this.loadFiles(path); }
  async goBack(): Promise<void> { const t = this.state.stepBack(); if (t !== null) await this.loadFiles(t); }
  async goForward(): Promise<void> { const t = this.state.stepForward(); if (t !== null) await this.loadFiles(t); }
  async goHome(): Promise<void> { await this.navigate('.'); }
  async refresh(): Promise<void> { await this.loadFiles(this.state.currentPath); }

  // ---- 剪贴板 ----
  copy(): void { this.setClipboard('copy'); }
  cut(): void { this.setClipboard('move'); }
  private setClipboard(mode: 'copy' | 'move'): void {
    const files = this.state.getSelectedEntries();
    if (!files.length) return;
    this.state.clipboard = {
      files, sourcePath: this.state.currentPath,
      sourceConnectionKey: this.state.connectionKey, mode,
    };
    this.ctx.notify(`已${mode === 'copy' ? '复制' : '剪切'} ${files.length} 项`);
  }
  async paste(): Promise<void> {
    const cb = this.state.clipboard;
    if (!cb) return;
    if (cb.sourceConnectionKey !== this.state.connectionKey) {
      this.ctx.notify('跨服务器传输将在后续版本支持', 'danger');
      return;
    }
    const conn = this.conn();
    try {
      for (const f of cb.files) {
        const src = joinPath(cb.sourcePath, f.name);
        const dst = joinPath(this.state.currentPath, f.name);
        if (src === dst) continue;
        if (cb.mode === 'move') await conn.rename(src, dst);
        else await conn.exec(`cp -r ${shq(src)} ${shq(dst)}`);
      }
      if (cb.mode === 'move') this.state.clipboard = null;
      await this.refresh();
    } catch (e) {
      this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
    }
  }

  // ---- CRUD ----
  async upload(files: FileList): Promise<void> {
    const conn = this.conn();
    try {
      for (const f of Array.from(files)) {
        await conn.uploadFile(joinPath(this.state.currentPath, f.name), f);
      }
      await this.refresh();
    } catch (e) {
      this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
    }
  }
  async download(): Promise<void> {
    const conn = this.conn();
    for (const f of this.state.getSelectedEntries()) {
      if (f.isDir) continue;
      try {
        const blob = await conn.downloadFile(joinPath(this.state.currentPath, f.name));
        triggerBrowserDownload(blob, f.name);
      } catch (e) {
        this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
      }
    }
  }
  async delete(): Promise<void> {
    const conn = this.conn();
    try {
      for (const f of this.state.getSelectedEntries()) {
        const p = joinPath(this.state.currentPath, f.name);
        if (f.isDir) await conn.deleteDirectory(p);
        else await conn.deleteFile(p);
      }
      await this.refresh();
    } catch (e) {
      this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
    }
  }
  async rename(oldName: string, newName: string): Promise<void> {
    try {
      await this.conn().rename(
        joinPath(this.state.currentPath, oldName),
        joinPath(this.state.currentPath, newName),
      );
      await this.refresh();
    } catch (e) {
      this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
    }
  }
  async mkdir(name: string): Promise<void> {
    try {
      await this.conn().mkdir(joinPath(this.state.currentPath, name));
      await this.refresh();
    } catch (e) {
      this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
    }
  }
  async chmod(name: string, mode: number): Promise<void> {
    try {
      await this.conn().chmod(joinPath(this.state.currentPath, name), mode);
      await this.refresh();
    } catch (e) {
      this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
    }
  }

  // ---- 搜索 ----
  filter(query: string): void {
    this.state.searchQuery = query.trim() || null;
    this.state.notify();
  }
  async search(query: string): Promise<SearchHit[]> {
    const cur = this.state.currentPath;
    const cmd = `find ${shq(cur)} -maxdepth 5 -iname ${shq('*' + query + '*')} 2>/dev/null | head -200`;
    const out = await this.conn().exec(cmd);
    return parseFindOutput(out);
  }

  // ---- 打开方式 ----
  async openWith(name: string, method: 'nano' | 'vim' | 'download'): Promise<void> {
    const path = joinPath(this.state.currentPath, name);
    if (method === 'download') {
      try {
        const blob = await this.conn().downloadFile(path);
        triggerBrowserDownload(blob, name);
      } catch (e) {
        this.ctx.notify(e instanceof Error ? e.message : String(e), 'danger');
      }
      return;
    }
    const request = this.pool.getRequest(this.state.connectionKey);
    if (request) this.ctx.openInTerminal(request, buildOpenCommand(method, path));
  }

  // ---- 排序 ----
  sort(by: SortKey): void { this.state.toggleSort(by); }
}
