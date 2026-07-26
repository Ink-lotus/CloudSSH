import type { SavedServer } from '../shared/server-data';
import type { SSHConnectionConfig } from '../terminal';

export type ExplorerConnectionKey = `saved:${number}` | `direct:${string}`;

export interface ExplorerTarget {
  key: ExplorerConnectionKey;
  source: 'saved' | 'direct';
  name: string;
  host: string;
  port: number;
  username: string;
}

export type ExplorerConnectSpec =
  | { source: 'saved'; serverId: number }
  | { source: 'direct'; config: SSHConnectionConfig };

export interface ExplorerConnectionRequest {
  target: ExplorerTarget;
  connect: ExplorerConnectSpec;
}

export function requestFromSavedServer(server: SavedServer): ExplorerConnectionRequest {
  return {
    target: {
      key: `saved:${server.id}`,
      source: 'saved',
      name: server.name,
      host: server.host,
      port: server.port,
      username: server.username,
    },
    connect: { source: 'saved', serverId: server.id },
  };
}

export function directTargetName(
  config: Pick<SSHConnectionConfig, 'host' | 'port' | 'username'>,
): string {
  const base = `${config.username}@${config.host}`;
  return config.port === 22 ? base : `${base}:${config.port}`;
}

export function requestFromDirectConfig(
  config: SSHConnectionConfig,
  id: string = crypto.randomUUID(),
): ExplorerConnectionRequest {
  return {
    target: {
      key: `direct:${id}`,
      source: 'direct',
      name: directTargetName(config),
      host: config.host,
      port: config.port,
      username: config.username,
    },
    connect: { source: 'direct', config },
  };
}
