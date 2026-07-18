/**
 * Moke 宿主集成桥接。
 *
 * 当阅读器嵌入 Moke 桌面客户端时（window.__MOKE_EMBEDDED === true），
 * 将阅读器事件上报给宿主，供拓展系统订阅。
 * 独立运行时（standalone）什么都不做。
 */

import type { Book } from '@/types/book';

// ---------------------------------------------------------------------------
// Tauri invoke helper
// ---------------------------------------------------------------------------

let _invoke: (<T>(cmd: string, args: Record<string, unknown>) => Promise<T>) | null | undefined;

async function resolveInvoke() {
  if (_invoke !== undefined) return _invoke;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    _invoke = invoke;
  } catch (err) {
    // Don't cache failure permanently — transient import failures
    // (bundler race, dev HMR) should be retried next time.
    console.warn('[mokeBridge] @tauri-apps/api not available:', err);
    _invoke = null;
  }
  return _invoke;
}

function _doEmit(event: string, data: Record<string, unknown>): Promise<void> {
  return resolveInvoke().then((invoke) => {
    if (!invoke) return;
    invoke('ext_reader_event', { event, data: withMokeContext(data) }).catch((err) => {
      console.error('[mokeBridge] invoke ext_reader_event failed:', err);
    });
  });
}

// ---------------------------------------------------------------------------
// Throttle for high-frequency events (leading + trailing edge)
// ---------------------------------------------------------------------------

const THROTTLE_MS = 500;

interface ThrottleEntry {
  lastSent: number;
  timer: ReturnType<typeof setTimeout> | null;
  latest: Record<string, unknown>;
}

const _throttleEntries = new Map<string, ThrottleEntry>();

function throttledEmit(event: string, data: Record<string, unknown>) {
  const now = Date.now();
  let entry = _throttleEntries.get(event);

  if (!entry || now - entry.lastSent >= THROTTLE_MS) {
    // Leading edge: emit immediately
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.lastSent = now;
    } else {
      entry = { lastSent: now, timer: null, latest: data };
      _throttleEntries.set(event, entry);
    }
    _doEmit(event, data);
    return;
  }

  // Within throttle window: store latest, schedule trailing emit
  entry.latest = data;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(
    () => {
      const e = _throttleEntries.get(event);
      if (e) {
        e.lastSent = Date.now();
        e.timer = null;
        _doEmit(event, e.latest);
      }
    },
    THROTTLE_MS - (now - entry.lastSent),
  );
}

// ---------------------------------------------------------------------------
// Embedded check
// ---------------------------------------------------------------------------

function isEmbedded(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__MOKE_EMBEDDED;
}

function withMokeContext(data: Record<string, unknown>): Record<string, unknown> {
  if (typeof window === 'undefined') return data;

  const mokeBookId = (window as any).__MOKE_BOOK_ID;
  if (!mokeBookId || data.moke_book_id) return data;

  return {
    ...data,
    moke_book_id: String(mokeBookId),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Events that should be throttled to avoid flooding extension backends. */
const THROTTLED_EVENTS = new Set(['page:changed']);

/**
 * 向 Moke 宿主上报阅读器事件。高频事件（如 page:changed）自动节流。
 *
 * 返回一个 Promise，resolve() 时表示事件已送达（或尽力送达）。
 * 调用方（尤其是关闭流程）应 await 此返回值，确保事件在窗口销毁前发出。
 */
export function emitReaderEvent(event: string, data: Record<string, unknown>): Promise<void> {
  if (!isEmbedded()) return Promise.resolve();

  if (THROTTLED_EVENTS.has(event)) {
    throttledEmit(event, data);
    return Promise.resolve();
  }

  return _doEmit(event, data);
}

/**
 * 从 readest 的 Book 对象提取事件数据。
 */
export function bookEventData(book: Book): Record<string, unknown> {
  return {
    book_id: book.hash,
    title: book.title ?? '',
    author: book.author ?? '',
    format: book.format ?? '',
    cover_url: book.coverImageUrl ?? '',
    language: book.primaryLanguage ?? '',
  };
}
