// 共享服务器数据获取 —— servers-app 与 explorer 复用

export interface ServerConfig {
  id: number;
  user_id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_method: 'password' | 'publickey';
  region?: string | null;
  inferred_hint?: string | null;
  created_at: string;
  updated_at: string;
}

/** 资源管理器/选择页所需的精简服务器信息 */
export interface SavedServer {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
}

/** ServerConfig → SavedServer（纯映射，可单测） */
export function toSavedServer(c: ServerConfig): SavedServer {
  return { id: c.id, name: c.name, host: c.host, port: c.port, username: c.username };
}

export class AuthRequiredError extends Error {
  constructor() { super('Authentication required'); this.name = 'AuthRequiredError'; }
}

/** 拉取已保存服务器列表 */
export async function fetchSavedServers(): Promise<SavedServer[]> {
  const res = await fetch('/api/servers');
  if (res.status === 401) throw new AuthRequiredError();
  if (!res.ok) throw new Error('Failed to fetch servers');
  const list = (await res.json()) as ServerConfig[];
  return list.map(toSavedServer);
}

/** 请求建立连接，返回主 WebSocket URL（含一次性 token） */
export async function connectServerWs(serverId: number): Promise<string> {
  const res = await fetch(`/api/servers/${serverId}/connect`, { method: 'POST' });
  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error || 'Connection failed');
    }
    throw new Error(`服务器错误 (${res.status})`);
  }
  const { wsUrl } = (await res.json()) as { wsUrl: string };
  return wsUrl;
}
