const MOKE_PROGRESS_STORAGE_PREFIX = 'moke:reading-progress:';

export function mokeProgressStorageKey(serverUrl: string, mokeBookId: string): string {
  return `${MOKE_PROGRESS_STORAGE_PREFIX}${encodeURIComponent(serverUrl)}:${encodeURIComponent(mokeBookId)}`;
}

/** Bootstrap the Moke reader globals before React starts. */
export function bootstrapMokeLaunchContext(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('moke') !== '1') return;

  // Cross-document View Transitions are attached to the navigation itself,
  // not to a particular button. Mark every Moke -> Readest document entry so
  // the same animation covers the host's read button and embedded-reader
  // button. The marker is cleared after the transition so normal Readest SPA
  // transitions keep their existing animation direction.
  const navigationApi = (
    window as Window & {
      navigation?: { activation?: { from?: { url?: string } | null } };
    }
  ).navigation;
  const fromUrl = navigationApi?.activation?.from?.url;
  if (fromUrl) {
    try {
      const fromPath = new URL(fromUrl).pathname.replace(/\/$/, '') || '/';
      if (fromPath !== '/readest' && !fromPath.startsWith('/readest/')) {
        const root = document.documentElement;
        root.dataset['mokeReaderTransition'] = 'enter';
        const clearMarker = () => {
          delete root.dataset['mokeReaderTransition'];
        };
        window.addEventListener(
          'pagereveal',
          (event) => {
            const transition = (
              event as Event & {
                viewTransition?: { finished: Promise<unknown> };
              }
            ).viewTransition;
            if (!transition) {
              clearMarker();
              return;
            }
            void transition.finished.finally(clearMarker).catch(() => undefined);
          },
          { once: true },
        );
        window.setTimeout(clearMarker, 1_000);
      }
    } catch {
      // Ignore malformed activation URLs and continue bootstrapping Moke.
    }
  }

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
