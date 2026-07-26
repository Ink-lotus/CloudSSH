import { describe, expect, it } from 'vitest';
import {
  directTargetName,
  requestFromDirectConfig,
  requestFromSavedServer,
} from '../../frontend/src/explorer/connection-target';

describe('explorer connection targets', () => {
  it('maps a saved server to a stable saved key and server-id connect spec', () => {
    const request = requestFromSavedServer({
      id: 7,
      name: '开发机',
      host: '10.0.0.2',
      port: 2222,
      username: 'root',
    });

    expect(request).toEqual({
      target: {
        key: 'saved:7',
        source: 'saved',
        name: '开发机',
        host: '10.0.0.2',
        port: 2222,
        username: 'root',
      },
      connect: { source: 'saved', serverId: 7 },
    });
  });

  it('creates an injected direct key without exposing credentials on the target', () => {
    const config = {
      host: 'ssh.example.com',
      port: 22,
      username: 'alice',
      password: 'secret-password',
      privateKey: 'secret-private-key',
      authMethod: 'password' as const,
    };

    const request = requestFromDirectConfig(config, 'abc');

    expect(request.target).toEqual({
      key: 'direct:abc',
      source: 'direct',
      name: 'alice@ssh.example.com',
      host: 'ssh.example.com',
      port: 22,
      username: 'alice',
    });
    expect(request.connect).toEqual({ source: 'direct', config });
    expect(request.target).not.toHaveProperty('password');
    expect(request.target).not.toHaveProperty('privateKey');
    expect(request.target).not.toHaveProperty('config');
  });

  it('omits the default SSH port from a direct target name', () => {
    expect(directTargetName({ host: 'ssh.example.com', port: 22, username: 'alice' }))
      .toBe('alice@ssh.example.com');
  });

  it('includes a non-default SSH port in a direct target name', () => {
    expect(directTargetName({ host: 'ssh.example.com', port: 2222, username: 'alice' }))
      .toBe('alice@ssh.example.com:2222');
  });
});
