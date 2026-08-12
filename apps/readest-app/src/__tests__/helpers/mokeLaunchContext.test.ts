import { beforeEach, describe, expect, it } from 'vitest';

import { bootstrapMokeLaunchContext, mokeProgressStorageKey } from '@/helpers/mokeLaunchContext';

describe('bootstrapMokeLaunchContext', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/reader?moke=1&mokeBookId=42');
    window.__MOKE_RESTORE_PROGRESS = null;
  });

  it('restores guest progress from local storage', () => {
    localStorage.setItem(
      mokeProgressStorageKey('', '42'),
      JSON.stringify({ location: 'epubcfi(/6/8)', updated_at: '2026-08-12T08:00:00.000Z' }),
    );

    bootstrapMokeLaunchContext();

    expect(window.__MOKE_RESTORE_PROGRESS).toMatchObject({ location: 'epubcfi(/6/8)' });
  });

  it('prefers a newer local snapshot over stale server progress in the URL', () => {
    const serverUrl = 'http://192.168.1.5:8080';
    localStorage.setItem(
      mokeProgressStorageKey(serverUrl, '42'),
      JSON.stringify({ location: 'local-new', updated_at: '2026-08-12T09:00:00.000Z' }),
    );
    const remote = JSON.stringify({
      location: 'server-old',
      updated_at: '2026-08-12T08:00:00.000Z',
    });
    window.history.replaceState(
      {},
      '',
      `/reader?moke=1&mokeBookId=42&mokeServerUrl=${encodeURIComponent(serverUrl)}` +
        `&mokeRestoreProgress=${encodeURIComponent(remote)}`,
    );

    bootstrapMokeLaunchContext();

    expect(window.__MOKE_RESTORE_PROGRESS).toMatchObject({ location: 'local-new' });
  });
});
