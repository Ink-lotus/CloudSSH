import { describe, expect, it } from 'vitest';
import {
  connectionPickerState,
  type SavedServerLoadState,
} from '../../frontend/src/explorer/server-picker';

describe('connectionPickerState', () => {
  it('defaults anonymous users to direct without fetching saved servers', () => {
    expect(connectionPickerState(false, { status: 'not_loaded' })).toEqual({
      activeSource: 'direct',
      shouldFetchSavedServers: false,
      sessionExpired: false,
      savedError: null,
    });
  });

  it('defaults authenticated users with saved servers to saved', () => {
    expect(connectionPickerState(true, {
      status: 'loaded',
      servers: [{ id: 7, name: '开发机', host: '10.0.0.2', port: 22, username: 'root' }],
    })).toEqual({
      activeSource: 'saved',
      shouldFetchSavedServers: false,
      sessionExpired: false,
      savedError: null,
    });
  });

  it('defaults authenticated users without saved servers to direct', () => {
    expect(connectionPickerState(true, { status: 'loaded', servers: [] }).activeSource)
      .toBe('direct');
  });

  it('requests saved servers once for an authenticated user', () => {
    expect(connectionPickerState(true, { status: 'not_loaded' }).shouldFetchSavedServers)
      .toBe(true);
    expect(connectionPickerState(true, { status: 'loading' }).shouldFetchSavedServers)
      .toBe(false);
  });

  it('keeps direct available and marks an expired session after a 401', () => {
    expect(connectionPickerState(true, { status: 'session_expired' })).toEqual({
      activeSource: 'direct',
      shouldFetchSavedServers: false,
      sessionExpired: true,
      savedError: null,
    });
  });

  it('keeps direct available while exposing other saved-server errors', () => {
    const load: SavedServerLoadState = { status: 'error', message: 'network unavailable' };
    expect(connectionPickerState(true, load)).toEqual({
      activeSource: 'direct',
      shouldFetchSavedServers: false,
      sessionExpired: false,
      savedError: 'network unavailable',
    });
  });
});
