// 凭据加密存储与最近连接记录（迁移自 auth-form.ts，origin 参数化以便测试）

export interface RecentConnection {
  id: string;
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'publickey';
  timestamp: number;
  region?: string;
  encryptedCred?: string;
}

const RECENT_KEY = 'cloudssh_recent_connections';
const MAX_RECENT = 5;

function defaultSecret(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}:cloudssh`;
}

async function deriveKey(salt: Uint8Array, secret: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(secret);
  const baseKey = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptCredentials(data: object, secret = defaultSecret()): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(salt, secret);
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded));
  const combined = new Uint8Array(salt.length + iv.length + encrypted.length);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(encrypted, salt.length + iv.length);
  let binary = '';
  for (let i = 0; i < combined.length; i++) binary += String.fromCharCode(combined[i]);
  return btoa(binary);
}

export async function decryptCredentials(
  stored: string,
  secret = defaultSecret(),
): Promise<{ host: string; port: string; username: string; password: string; privateKey?: string; authMethod?: string } | null> {
  try {
    const raw = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    const salt = raw.slice(0, 16);
    const iv = raw.slice(16, 28);
    const data = raw.slice(28);
    const key = await deriveKey(salt, secret);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    return null;
  }
}

/** 去重（按 id）+ 置顶 + 上限，返回新数组（纯函数） */
export function computeRecentList(existing: RecentConnection[], record: RecentConnection, max = MAX_RECENT): RecentConnection[] {
  const deduped = existing.filter((r) => r.id !== record.id);
  deduped.unshift(record);
  return deduped.slice(0, max);
}

export function readRecentConnections(): RecentConnection[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecentConnection(record: RecentConnection): void {
  const list = computeRecentList(readRecentConnections(), record);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage disabled */ }
}

export function deleteRecentConnection(index: number): void {
  const list = readRecentConnections();
  if (index < 0 || index >= list.length) return;
  list.splice(index, 1);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage disabled */ }
}
