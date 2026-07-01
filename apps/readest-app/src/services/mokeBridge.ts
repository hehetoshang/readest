/**
 * Moke 宿主集成桥接。
 *
 * 当阅读器嵌入 Moke 桌面客户端时（window.__MOKE_EMBEDDED === true），
 * 将阅读器事件上报给宿主，供拓展系统订阅。
 * 独立运行时（standalone）什么都不做。
 */

import type { Book } from '@/types/book';

let _invokeExtReaderEvent: ((event: string, data: Record<string, unknown>) => void) | null = null;

async function getInvoke() {
  if (_invokeExtReaderEvent) return _invokeExtReaderEvent;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    _invokeExtReaderEvent = (event: string, data: Record<string, unknown>) => {
      invoke('ext_reader_event', { event, data }).catch((err) => {
        console.error('[mokeBridge] invoke ext_reader_event failed:', err);
      });
    };
    console.log('[mokeBridge] Tauri invoke ready');
  } catch (err) {
    console.warn('[mokeBridge] @tauri-apps/api not available:', err);
    _invokeExtReaderEvent = () => {};
  }
  return _invokeExtReaderEvent;
}

function isEmbedded(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__MOKE_EMBEDDED;
}

export async function emitReaderEvent(event: string, data: Record<string, unknown>) {
  if (!isEmbedded()) {
    console.log('[mokeBridge] skip event (not embedded):', event);
    return;
  }
  console.log('[mokeBridge] emit event:', event, data);
  const fn = await getInvoke();
  fn(event, data);
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
  };
}
