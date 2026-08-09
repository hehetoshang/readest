import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const THROTTLE_MS = 500;

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { emitReaderEvent, throttleEntryCount } from '@/services/mokeBridge';

describe('mokeBridge throttle table lifecycle', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    window.__MOKE_EMBEDDED = true;
    window.__MOKE_SERVER_URL = null;
    window.__MOKE_BOOK_ID = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.__MOKE_EMBEDDED = false;
  });

  /** 冲刷 _doEmit 的异步 resolveInvoke/invoke 链（advanceTimersByTimeAsync 会同时清空微任务） */
  async function flush() {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  }

  it('释放 leading edge 后的节流条目（事件停止后表为空）', async () => {
    void emitReaderEvent('page:changed', { page: 1 });
    await flush();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(throttleEntryCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(THROTTLE_MS);
    expect(throttleEntryCount()).toBe(0);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('trailing emit 触发后释放条目，不残留 lastSent/latest', async () => {
    void emitReaderEvent('page:changed', { page: 1 });
    await flush();
    await vi.advanceTimersByTimeAsync(300);

    void emitReaderEvent('page:changed', { page: 2 });
    await flush();
    expect(invokeMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    // trailing 已发出，条目再保留一个窗口用于节流，随后释放
    expect(throttleEntryCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(THROTTLE_MS);
    expect(throttleEntryCount()).toBe(0);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('节流窗口内合并多次事件，只发 leading + trailing，之后表清空', async () => {
    void emitReaderEvent('page:changed', { page: 1 });
    await flush();
    for (const page of [2, 3, 4]) {
      await vi.advanceTimersByTimeAsync(100);
      void emitReaderEvent('page:changed', { page });
      await flush();
    }

    expect(invokeMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(THROTTLE_MS);
    expect(invokeMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(THROTTLE_MS);
    expect(throttleEntryCount()).toBe(0);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
