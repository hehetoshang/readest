/**
 * Moke extension command listener.
 *
 * When the readest reader runs embedded inside the Moke desktop client
 * (window.__MOKE_EMBEDDED === true), this hook listens for `reader:command`
 * events sent by the host's extension API server and dispatches them to the
 * appropriate FoliateView or readerStore method.
 *
 * Supported commands:
 * - go_to_fraction  { fraction: number }
 * - go_to_href      { href: string }
 * - next_page
 * - prev_page
 * - get_position
 */

import { useEffect, useRef } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { emitReaderEvent } from '@/services/mokeBridge';

interface CommandPayload {
  request_id?: string;
  command: string;
  fraction?: number;
  href?: string;
}

function isEmbedded(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__MOKE_EMBEDDED;
}

function getPrimaryKey(bookKeys: string[]): string | null {
  const { viewStates } = useReaderStore.getState();
  return bookKeys.find((k) => viewStates[k]?.isPrimary) ?? bookKeys[0] ?? null;
}

function executeCommand(payload: CommandPayload, bookKeys: string[]): unknown {
  const key = getPrimaryKey(bookKeys);
  const view = key ? useReaderStore.getState().getView(key) : null;

  switch (payload.command) {
    case 'go_to_fraction': {
      if (typeof payload.fraction !== 'number') {
        throw new Error('go_to_fraction requires a fraction number');
      }
      if (!view) throw new Error('No active reader view');
      view.goToFraction(payload.fraction);
      return { fraction: payload.fraction };
    }

    case 'go_to_href': {
      if (typeof payload.href !== 'string') {
        throw new Error('go_to_href requires an href string');
      }
      if (!view) throw new Error('No active reader view');
      view.goTo(payload.href);
      return { href: payload.href };
    }

    case 'next_page': {
      if (!view) throw new Error('No active reader view');
      view.next();
      return { ok: true };
    }

    case 'prev_page': {
      if (!view) throw new Error('No active reader view');
      view.prev();
      return { ok: true };
    }

    case 'get_position': {
      if (!key) throw new Error('No active reader view');
      const progress = useReaderStore.getState().getProgress(key);
      const viewState = useReaderStore.getState().getViewState(key);
      return {
        view_key: key,
        is_primary: viewState?.isPrimary ?? false,
        progress: progress
          ? {
              page: progress.page,
              fraction: progress.fraction,
              section_label: progress.sectionLabel,
              section_href: progress.sectionHref,
            }
          : null,
      };
    }

    default:
      throw new Error(`Unknown command: ${payload.command}`);
  }
}

function reportResult(payload: CommandPayload, success: boolean, resultOrError: unknown) {
  emitReaderEvent('command:result', {
    request_id: payload.request_id ?? '',
    command: payload.command,
    success,
    ...(success ? { result: resultOrError } : { error: String(resultOrError) }),
  });
}

export function useMokeCommandListener(bookKeys: string[]) {
  const bookKeysRef = useRef(bookKeys);
  bookKeysRef.current = bookKeys;

  useEffect(() => {
    if (!isEmbedded()) return;

    let unlisten: (() => void) | undefined;

    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        return getCurrentWindow().listen<CommandPayload>('reader:command', (event) => {
          const payload = event.payload;
          console.log('[mokeCommand] received:', payload.command);

          try {
            const result = executeCommand(payload, bookKeysRef.current);
            reportResult(payload, true, result);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[mokeCommand] failed:', message);
            reportResult(payload, false, message);
          }
        });
      })
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch((err) => {
        console.warn('[mokeCommand] could not listen for reader:command:', err);
      });

    return () => {
      unlisten?.();
    };
  }, []);
}
