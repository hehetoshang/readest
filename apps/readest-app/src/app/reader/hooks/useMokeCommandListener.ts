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
 * - go_to_location  { location: string }
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
  location?: string;
}

/** `window.__MOKE_RESTORE_PROGRESS` 的运行时结构（由 Moke launch script 注入）。 */
interface RestoreProgress {
  location?: string;
  section_href?: string;
  fraction?: number;
}

function isEmbedded(): boolean {
  return typeof window !== 'undefined' && !!window.__MOKE_EMBEDDED;
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

    case 'go_to_location': {
      if (typeof payload.location !== 'string') {
        throw new Error('go_to_location requires a location string');
      }
      if (!view) throw new Error('No active reader view');
      view.goTo(payload.location);
      return { location: payload.location };
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
  const restoredRef = useRef(false);
  bookKeysRef.current = bookKeys;

  useEffect(() => {
    if (!isEmbedded()) return;

    // H20-L5: `@tauri-apps/api/window` 是异步 import，组件可能在 import
    // resolve 之前就卸载。用 disposed 标志：resolve 后若已卸载，立即
    // unlisten，避免监听器永久挂在窗口上泄漏。
    let disposed = false;
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
        if (disposed) {
          cleanup();
        } else {
          unlisten = cleanup;
        }
      })
      .catch((err) => {
        console.warn('[mokeCommand] could not listen for reader:command:', err);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isEmbedded() || restoredRef.current || bookKeys.length === 0) return;

    const restoreProgress = window.__MOKE_RESTORE_PROGRESS;
    if (!restoreProgress || typeof restoreProgress !== 'object') return;

    const progress = restoreProgress as RestoreProgress;
    const location = typeof progress.location === 'string' ? progress.location : '';
    const href = typeof progress.section_href === 'string' ? progress.section_href : '';
    const fraction = typeof progress.fraction === 'number' ? progress.fraction : null;
    const command: CommandPayload | null = location
      ? { command: 'go_to_location', location }
      : href
        ? { command: 'go_to_href', href }
        : fraction !== null
          ? { command: 'go_to_fraction', fraction }
          : null;

    if (!command) return;

    // H20-L2: 恢复命令不再固定重试 20×250ms（5s）就放弃。大书 / 慢设备上
    // view 可能迟迟没有 attach，5s 窗口内抓不到就永久 `restoredRef=true`，
    // 本次会话不再恢复。改为：
    //  1. 监听 readerStore，等主 view `inited` 后再执行恢复命令；
    //  2. 兜底用带退避的重试（次数与间隔放宽），避免订阅漏触发。
    let cancelled = false;
    let attempts = 0;
    let timer: number | null = null;

    const reportResultSafe = (ok: boolean, resultOrError: unknown) => {
      reportResult({ ...command, request_id: 'moke-restore-progress' }, ok, resultOrError);
    };

    const tryRestore = () => {
      if (cancelled || restoredRef.current) return;
      attempts += 1;

      try {
        executeCommand(command, bookKeysRef.current);
        restoredRef.current = true;
        if (timer) window.clearTimeout(timer);
        timer = null;
        reportResultSafe(true, { restored: true });
      } catch (err) {
        // 退避：250ms 起步，翻倍封顶 4s；最多 60 次（远大于原 20 次）。
        const delay = Math.min(250 * Math.pow(2, Math.min(attempts - 1, 4)), 4000);
        if (attempts < 60) {
          timer = window.setTimeout(tryRestore, delay);
        } else {
          // 终态：无论成功与否都标记本次会话已处理，避免把旧的
          // __MOKE_RESTORE_PROGRESS 重放到后续打开的书上。
          restoredRef.current = true;
          const message = err instanceof Error ? err.message : String(err);
          reportResultSafe(false, message);
        }
      }
    };

    // 主 view 就绪（book:opened / viewer ready）后再执行恢复命令，
    // 避免在 view 尚未 attach 时空转耗尽重试次数。
    const primaryKey = getPrimaryKey(bookKeysRef.current);
    const unsub = useReaderStore.subscribe((state) => {
      if (cancelled || restoredRef.current) return;
      const viewState = primaryKey ? state.viewStates[primaryKey] : null;
      if (viewState?.inited && viewState?.view) {
        if (timer) window.clearTimeout(timer);
        timer = null;
        tryRestore();
      }
    });

    // 启动一个初始的尝试（若 view 已就绪则立即成功，否则进入退避重试）。
    timer = window.setTimeout(tryRestore, 250);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      unsub();
    };
  }, [bookKeys]);
}
