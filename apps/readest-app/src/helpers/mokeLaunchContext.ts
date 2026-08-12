const MOKE_PROGRESS_STORAGE_PREFIX = 'moke:reading-progress:';

export function mokeProgressStorageKey(serverUrl: string, mokeBookId: string): string {
  return `${MOKE_PROGRESS_STORAGE_PREFIX}${encodeURIComponent(serverUrl)}:${encodeURIComponent(mokeBookId)}`;
}

/** Bootstrap the Moke reader globals before React starts. */
export function bootstrapMokeLaunchContext(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('moke') !== '1') return;

  const serverUrl = params.get('mokeServerUrl') || '';
  const mokeBookId = params.get('mokeBookId') || '';
  window.__MOKE_EMBEDDED = true;
  window.__MOKE_EINK = params.get('mokeEink') === '1';
  window.__MOKE_BOOK_ID = mokeBookId || null;
  window.__MOKE_SERVER_URL = serverUrl || null;
  let remoteProgress: Record<string, unknown> | null = null;
  const progress = params.get('mokeRestoreProgress');
  if (progress) {
    try {
      const parsed: unknown = JSON.parse(progress);
      if (parsed && typeof parsed === 'object') {
        remoteProgress = parsed as Record<string, unknown>;
      }
    } catch {
      remoteProgress = null;
    }
  }

  let localProgress: Record<string, unknown> | null = null;
  if (mokeBookId) {
    try {
      const prefix = 'moke:reading-progress:';
      const key = `${prefix}${encodeURIComponent(serverUrl)}:${encodeURIComponent(mokeBookId)}`;
      const stored = window.localStorage.getItem(key);
      const parsed: unknown = stored ? JSON.parse(stored) : null;
      if (parsed && typeof parsed === 'object') {
        localProgress = parsed as Record<string, unknown>;
      }
    } catch {
      localProgress = null;
    }
  }

  if (!localProgress) {
    window.__MOKE_RESTORE_PROGRESS = remoteProgress;
    return;
  }
  if (!remoteProgress) {
    window.__MOKE_RESTORE_PROGRESS = localProgress;
    return;
  }

  const localTime = Date.parse(String(localProgress['updated_at'] || ''));
  const remoteTime = Date.parse(String(remoteProgress['updated_at'] || ''));
  window.__MOKE_RESTORE_PROGRESS =
    Number.isFinite(localTime) && (!Number.isFinite(remoteTime) || localTime >= remoteTime)
      ? localProgress
      : remoteProgress;
}
