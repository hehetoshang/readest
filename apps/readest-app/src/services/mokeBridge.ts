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
    // Leading edge: emit immediately.
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.lastSent = now;
    } else {
      entry = { lastSent: now, timer: null, latest: data };
      _throttleEntries.set(event, entry);
    }
    entry.latest = data;
    // Release the entry once the throttle window elapses with no further
    // events, so _throttleEntries never retains idle state.
    entry.timer = setTimeout(() => {
      _throttleEntries.delete(event);
    }, THROTTLE_MS);
    _doEmit(event, data);
    return;
  }

  // Within throttle window: store latest, schedule trailing emit.
  entry.latest = data;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(
    () => {
      _doEmit(event, entry.latest);
      entry.lastSent = Date.now();
      // Keep throttling for events that resume right after the trailing emit,
      // then release the entry once a full window passes without new events.
      entry.timer = setTimeout(() => {
        _throttleEntries.delete(event);
      }, THROTTLE_MS);
    },
    THROTTLE_MS - (now - entry.lastSent),
  );
}

/**
 * 仅测试用：当前节流表中存留的事件条目数。生产逻辑不依赖此值。
 */
export function throttleEntryCount(): number {
  return _throttleEntries.size;
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
  if (!mokeBookId || data['moke_book_id']) return data;

  return {
    ...data,
    moke_book_id: String(mokeBookId),
  };
}

// ---------------------------------------------------------------------------
// Moke 服务器进度直存（单 WebView 运行时专用）
// ---------------------------------------------------------------------------
//
// 在 Android / iOS / OHOS 上，宿主 Moke 应用只有唯一一个 WebView。打开阅读器时
// Moke 会整页导航到 `/readest/reader`，把 Moke 应用（含 ReaderProgressProvider）
// 卸载掉——桌面端由主窗口消费的 `reader:page:changed` 事件在移动端没有监听者。
// 因此宿主会把 serverUrl 通过 `mokeServerUrl` 查询参数透传进来，由阅读器在嵌入
// 模式下直接把进度保存到 Moke 服务器（与桌面端 ReaderProgressProvider 的保存
// 逻辑保持一致，POST 到 `/api/book/{id}/progress`）。
//
// 桌面端阅读器窗口拿不到 `mokeServerUrl`（宿主不传），所以这里不会与桌面端
// 主窗口的 ReaderProgressProvider 重复保存。

const PROGRESS_SAVE_DEBOUNCE_MS = 1200;

let progressSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingProgress: Record<string, unknown> | null = null;

function progressStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function progressNumberValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

async function saveProgressToMokeServer(data: Record<string, unknown>): Promise<void> {
  const serverUrl = (window as any).__MOKE_SERVER_URL;
  const mokeBookId = (window as any).__MOKE_BOOK_ID;
  if (typeof serverUrl !== 'string' || !serverUrl || !mokeBookId) return;

  const payload = {
    schema: 'moke.readest.progress.v1',
    reader: 'readest',
    moke_book_id: String(mokeBookId),
    reader_book_id: progressStringValue(data['book_id']),
    view_key: progressStringValue(data['view_key']),
    location: progressStringValue(data['location']),
    section_href: progressStringValue(data['section_href']),
    chapter: progressStringValue(data['chapter']),
    page: progressNumberValue(data['page']),
    total_pages: progressNumberValue(data['total_pages']),
    progress: progressNumberValue(data['progress']),
    fraction: progressNumberValue(data['fraction']),
    updated_at: new Date().toISOString(),
  };

  try {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    await tauriFetch(`${serverUrl}/api/book/${String(mokeBookId)}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: payload }),
      credentials: 'include',
      maxRedirections: 5,
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    } as unknown as RequestInit);
  } catch (error) {
    // 尽力而为：保存失败不打断阅读，下一次翻页或关闭书籍时会重试。
    console.warn('[mokeBridge] 保存阅读进度到 Moke 服务器失败:', error);
  }
}

function scheduleProgressSave(data: Record<string, unknown>): void {
  pendingProgress = data;
  if (progressSaveTimer) clearTimeout(progressSaveTimer);
  progressSaveTimer = setTimeout(() => {
    progressSaveTimer = null;
    const latest = pendingProgress;
    pendingProgress = null;
    if (latest) void saveProgressToMokeServer(latest);
  }, PROGRESS_SAVE_DEBOUNCE_MS);
}

function flushProgressSave(): Promise<void> {
  if (progressSaveTimer) {
    clearTimeout(progressSaveTimer);
    progressSaveTimer = null;
  }
  const latest = pendingProgress;
  pendingProgress = null;
  if (!latest) return Promise.resolve();
  return saveProgressToMokeServer(latest);
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

  // 单 WebView 运行时宿主应用已被卸载，这里由阅读器直接保存进度。
  if (event === 'page:changed' && typeof (window as any).__MOKE_SERVER_URL === 'string') {
    scheduleProgressSave(data);
  }

  // 关闭书籍前先冲刷待保存的进度，确保最后一页不丢失。
  if (event === 'book:closed') {
    return flushProgressSave().then(() => _doEmit(event, data));
  }

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
