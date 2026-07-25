// 独立 SFTP WebSocket 连接 —— 全部操作 Promise 化（从 SFTPPanel 提取）

export interface SFTPFileEntry {
  name: string;
  type: 'dir' | 'link' | 'file';
  size: number;
  sizeFormatted: string;
  permissions: string;
  permissionsRaw: number;
  modifiedTime: number;
  isDir: boolean;
  isLink: boolean;
}

export type ProgressCb = (loaded: number, total: number) => void;
export type GetSFTPWebSocketUrlFn = () => string | null;

export interface SFTPConnectionCallbacks {
  onReady: () => void;
  onDisconnect: () => void;
  onError: (err: string) => void;
}

const SFTP_HEARTBEAT_INTERVAL_MS = 30000;
const UPLOAD_CHUNK_SIZE = 128 * 1024;

class Deferred<T> {
  promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: unknown) => void;
  constructor() {
    this.promise = new Promise<T>((res, rej) => { this.resolve = res; this.reject = rej; });
  }
}

export class SFTPConnection {
  private ws: WebSocket | null = null;
  private getWebSocketUrl: GetSFTPWebSocketUrlFn;
  private cbs: SFTPConnectionCallbacks | null = null;
  private ready = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  private queueTail: Promise<void> = Promise.resolve();
  private pending: Deferred<any> | null = null;
  private expectedType: string | null = null;

  private downloadChunks: Uint8Array[] = [];
  private downloadDeferred: Deferred<Blob> | null = null;
  private downloadProgress: ProgressCb | null = null;
  private downloadTotal = 0;
  private uploadReadyDeferred: Deferred<void> | null = null;
  private uploadProgressDeferred: Deferred<number> | null = null;
  private uploadDoneDeferred: Deferred<void> | null = null;

  private execPending = new Map<string, Deferred<string>>();
  private execSeq = 0;

  constructor(getWebSocketUrl: GetSFTPWebSocketUrlFn) {
    this.getWebSocketUrl = getWebSocketUrl;
  }

  connect(cbs: SFTPConnectionCallbacks): void {
    this.cbs = cbs;
    const url = this.getWebSocketUrl();
    if (!url) { cbs.onError('SFTP 地址不可用'); return; }

    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => { this.send({ type: 'sftp_init' }); this.startHeartbeat(); };
    ws.onmessage = (e) => this.handleMessage(e.data);
    ws.onclose = () => { this.ready = false; this.stopHeartbeat(); this.cbs?.onDisconnect(); };
    ws.onerror = () => this.cbs?.onError('SFTP 连接错误');
  }

  isReady(): boolean { return this.ready; }

  dispose(): void {
    this.stopHeartbeat();
    this.ready = false;
    try { this.ws?.close(1000); } catch { /* ignore */ }
    this.ws = null;
    this.pending?.reject(new Error('连接已关闭'));
    this.pending = null;
    this.execPending.forEach((d) => d.reject(new Error('连接已关闭')));
    this.execPending.clear();
  }

  private startHeartbeat(): void {
    this.heartbeat = setInterval(() => this.send({ type: 'ping' }), SFTP_HEARTBEAT_INTERVAL_MS);
  }
  private stopHeartbeat(): void {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  private sendBinary(data: ArrayBuffer | Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  private handleMessage(data: string | ArrayBuffer): void {
    if (typeof data !== 'string') {
      const chunk = new Uint8Array(data);
      this.downloadChunks.push(chunk);
      if (this.downloadProgress) {
        const loaded = this.downloadChunks.reduce((s, c) => s + c.length, 0);
        this.downloadProgress(loaded, this.downloadTotal);
      }
      return;
    }
    let msg: any;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {
      case 'sftp_ready':
        this.ready = true;
        this.cbs?.onReady();
        break;
      case 'pong':
        break;
      case 'sftp_list_result':
        this.resolvePending('sftp_list_result', msg.entries as SFTPFileEntry[]);
        break;
      case 'sftp_stat_result':
        this.resolvePending('sftp_stat_result', msg);
        break;
      case 'sftp_delete_result':
        this.resolvePending('sftp_delete_result', undefined);
        break;
      case 'sftp_rmdir_result':
        this.resolvePending('sftp_rmdir_result', undefined);
        break;
      case 'sftp_rename_result':
        this.resolvePending('sftp_rename_result', undefined);
        break;
      case 'sftp_mkdir_result':
        this.resolvePending('sftp_mkdir_result', undefined);
        break;
      case 'sftp_chmod_result':
        this.resolvePending('sftp_chmod_result', undefined);
        break;
      case 'sftp_read_text_result':
        this.resolvePending('sftp_read_text_result', msg.content as string);
        break;
      case 'sftp_download_start':
        this.downloadChunks = [];
        this.downloadTotal = msg.size || 0;
        break;
      case 'sftp_download_done': {
        const blob = new Blob(this.downloadChunks as BlobPart[]);
        this.downloadChunks = [];
        this.downloadDeferred?.resolve(blob);
        this.downloadDeferred = null;
        this.downloadProgress = null;
        break;
      }
      case 'sftp_upload_ready':
        this.uploadReadyDeferred?.resolve();
        this.uploadReadyDeferred = null;
        break;
      case 'sftp_upload_progress':
        this.uploadProgressDeferred?.resolve(msg.loaded || 0);
        this.uploadProgressDeferred = null;
        break;
      case 'sftp_upload_complete':
        this.uploadDoneDeferred?.resolve();
        this.uploadDoneDeferred = null;
        break;
      case 'sftp_exec_result': {
        const d = this.execPending.get(msg.id);
        if (d) {
          this.execPending.delete(msg.id);
          if (msg.exitCode === 0) d.resolve(msg.stdout);
          else d.reject(new Error(msg.stderr || `exit ${msg.exitCode}`));
        }
        break;
      }
      case 'sftp_error':
        this.rejectPending(msg.message || 'SFTP 操作失败');
        this.downloadDeferred?.reject(new Error(msg.message));
        this.uploadReadyDeferred?.reject(new Error(msg.message));
        this.uploadProgressDeferred?.reject(new Error(msg.message));
        this.uploadDoneDeferred?.reject(new Error(msg.message));
        break;
    }
  }

  private resolvePending(type: string, value: unknown): void {
    if (this.pending && this.expectedType === type) {
      const d = this.pending;
      this.pending = null; this.expectedType = null;
      d.resolve(value);
    }
  }
  private rejectPending(message: string): void {
    if (this.pending) {
      const d = this.pending;
      this.pending = null; this.expectedType = null;
      d.reject(new Error(message));
    }
  }

  private request<T>(msg: Record<string, unknown>, expectedType: string): Promise<T> {
    const run = this.queueTail.then(() => {
      const d = new Deferred<T>();
      this.pending = d;
      this.expectedType = expectedType;
      this.send(msg);
      return d.promise;
    });
    this.queueTail = run.then(() => undefined, () => undefined);
    return run;
  }

  listDirectory(path: string): Promise<SFTPFileEntry[]> {
    return this.request<SFTPFileEntry[]>({ type: 'sftp_list', path }, 'sftp_list_result');
  }
  stat(path: string): Promise<SFTPFileEntry> {
    return this.request<SFTPFileEntry>({ type: 'sftp_stat', path }, 'sftp_stat_result');
  }
  deleteFile(path: string): Promise<void> {
    return this.request<void>({ type: 'sftp_delete', path }, 'sftp_delete_result');
  }
  deleteDirectory(path: string): Promise<void> {
    return this.request<void>({ type: 'sftp_rmdir', path }, 'sftp_rmdir_result');
  }
  rename(oldPath: string, newPath: string): Promise<void> {
    return this.request<void>({ type: 'sftp_rename', oldPath, newPath }, 'sftp_rename_result');
  }
  mkdir(path: string): Promise<void> {
    return this.request<void>({ type: 'sftp_mkdir', path }, 'sftp_mkdir_result');
  }
  chmod(path: string, mode: number): Promise<void> {
    return this.request<void>({ type: 'sftp_chmod', path, mode }, 'sftp_chmod_result');
  }
  readTextFile(path: string): Promise<string> {
    return this.request<string>({ type: 'sftp_read_text', path }, 'sftp_read_text_result');
  }

  exec(command: string, timeout = 30000): Promise<string> {
    const id = `exec-${++this.execSeq}`;
    const d = new Deferred<string>();
    this.execPending.set(id, d);
    const run = this.queueTail.then(() => {
      this.send({ type: 'sftp_exec', id, command, timeout });
      return d.promise;
    });
    this.queueTail = run.then(() => undefined, () => undefined);
    return run;
  }

  downloadFile(path: string, onProgress?: ProgressCb): Promise<Blob> {
    const run = this.queueTail.then(() => {
      this.downloadDeferred = new Deferred<Blob>();
      this.downloadChunks = [];
      this.downloadProgress = onProgress || null;
      this.send({ type: 'sftp_download', path });
      return this.downloadDeferred.promise;
    });
    this.queueTail = run.then(() => undefined, () => undefined);
    return run;
  }

  uploadFile(path: string, data: Blob, onProgress?: ProgressCb): Promise<void> {
    const run = this.queueTail.then(async () => {
      const total = data.size;
      this.uploadReadyDeferred = new Deferred<void>();
      this.send({ type: 'sftp_upload_start', path, size: total });
      await this.uploadReadyDeferred.promise;

      const reader = data.stream().getReader();
      let sent = 0;
      let buffer = new Uint8Array(0);
      const flushChunk = async (chunk: Uint8Array) => {
        this.uploadProgressDeferred = new Deferred<number>();
        this.sendBinary(chunk);
        await this.uploadProgressDeferred.promise;
        sent += chunk.length;
        onProgress?.(sent, total);
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const merged = new Uint8Array(buffer.length + value.length);
        merged.set(buffer, 0); merged.set(value, buffer.length);
        buffer = merged;
        while (buffer.length >= UPLOAD_CHUNK_SIZE) {
          await flushChunk(buffer.subarray(0, UPLOAD_CHUNK_SIZE));
          buffer = buffer.subarray(UPLOAD_CHUNK_SIZE);
        }
      }
      if (buffer.length > 0) await flushChunk(buffer);

      this.uploadDoneDeferred = new Deferred<void>();
      this.send({ type: 'sftp_upload_end' });
      await this.uploadDoneDeferred.promise;
    });
    this.queueTail = run.then(() => undefined, () => undefined);
    return run;
  }
}
