import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const listenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ listen: listenMock }),
}));

const {
  emitReaderEventMock,
  beginMokeAnnotationNavigationMock,
  completeMokeAnnotationNavigationMock,
  cancelMokeAnnotationNavigationMock,
} = vi.hoisted(() => ({
  emitReaderEventMock: vi.fn(),
  beginMokeAnnotationNavigationMock: vi.fn(),
  completeMokeAnnotationNavigationMock: vi.fn(),
  cancelMokeAnnotationNavigationMock: vi.fn(),
}));

vi.mock('@/services/mokeBridge', () => ({
  emitReaderEvent: emitReaderEventMock,
  beginMokeAnnotationNavigation: beginMokeAnnotationNavigationMock,
  completeMokeAnnotationNavigation: completeMokeAnnotationNavigationMock,
  cancelMokeAnnotationNavigation: cancelMokeAnnotationNavigationMock,
}));

// readerStore: a bare minimum stand-in with getState / subscribe.
type ViewLike = { goTo: () => void; goToFraction: () => void; next: () => void; prev: () => void };
type ViewState = { view: ViewLike | null; inited: boolean; isPrimary: boolean };
type ReaderState = {
  viewStates: Record<string, ViewState>;
  getView: (key: string | null) => ViewLike | null;
  getProgress: (key: string) => unknown;
  getViewState: (key: string) => ViewState | null;
};

const readerState: ReaderState = {
  viewStates: {},
  getView: (key) => (key && readerState.viewStates[key]?.view) || null,
  getProgress: () => null,
  getViewState: (key) => readerState.viewStates[key] || null,
};

const readerSubscribers: Array<(state: ReaderState) => void> = [];

vi.mock('@/store/readerStore', () => {
  const useReaderStore = () => readerState;
  useReaderStore.getState = () => readerState;
  useReaderStore.subscribe = (fn: (state: ReaderState) => void) => {
    readerSubscribers.push(fn);
    return () => {
      const i = readerSubscribers.indexOf(fn);
      if (i >= 0) readerSubscribers.splice(i, 1);
    };
  };
  return { useReaderStore };
});

import { useMokeCommandListener } from '@/app/reader/hooks/useMokeCommandListener';

const viewLike = (): ViewLike => ({
  goTo: vi.fn(),
  goToFraction: vi.fn(),
  next: vi.fn(),
  prev: vi.fn(),
});

function flushMicrotasks() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// Resolves the listen() promise so the hook stores the cleanup fn.
function settleListen(cleanupFn = vi.fn()) {
  let resolve!: (c: () => void) => void;
  listenMock.mockReturnValue(
    new Promise<() => void>((r) => {
      resolve = r;
    }),
  );
  return {
    cleanupFn,
    resolve: () => resolve(cleanupFn),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readerSubscribers.length = 0;
  readerState.viewStates = {};
  window.__MOKE_EMBEDDED = true;
  window.__MOKE_RESTORE_PROGRESS = null;
});

afterEach(() => {
  cleanup();
  window.__MOKE_EMBEDDED = false;
  window.__MOKE_RESTORE_PROGRESS = null;
});

// ---------------------------------------------------------------------------
// H20-L5: async-import listener must not leak after unmount
// ---------------------------------------------------------------------------

describe('useMokeCommandListener listener lifecycle (H20-L5)', () => {
  it('cleans up the listener when unmounting after import resolves', async () => {
    const { cleanupFn, resolve } = settleListen();
    const { unmount } = renderHook(() => useMokeCommandListener(['bookA-1']));
    resolve();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(cleanupFn).not.toHaveBeenCalled();
    unmount();
    expect(cleanupFn).toHaveBeenCalled();
  });

  it('immediately unlistens when the import resolves after unmount', async () => {
    // Deferred resolution: unmount before the listen promise resolves.
    const { cleanupFn, resolve } = settleListen();
    const { unmount } = renderHook(() => useMokeCommandListener(['bookA-1']));
    unmount();

    // Import resolves now — the hook must call cleanup immediately, not leak.
    resolve();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(cleanupFn).toHaveBeenCalled();
  });

  it('forwards reader:command payloads to the result channel', async () => {
    const { resolve } = settleListen();
    renderHook(() => useMokeCommandListener(['bookA-1']));
    resolve();
    await flushMicrotasks();
    await flushMicrotasks();

    const registered = listenMock.mock.calls[0]?.[1] as (e: { payload: unknown }) => void;
    readerState.viewStates['bookA-1'] = {
      view: viewLike(),
      inited: true,
      isPrimary: true,
    };
    registered({ payload: { command: 'get_position', request_id: 'r1' } });
    await flushMicrotasks();

    expect(emitReaderEventMock).toHaveBeenCalledWith(
      'command:result',
      expect.objectContaining({ request_id: 'r1', command: 'get_position' }),
    );
  });
});

// ---------------------------------------------------------------------------
// H20-L2: restore retry waits for the primary view and backs off
// ---------------------------------------------------------------------------

describe('useMokeCommandListener restore retry (H20-L2)', () => {
  it('restores once the primary view becomes inited', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.__MOKE_RESTORE_PROGRESS = { location: 'epubcfi(/6/4!/4/2)' };
    const { resolve } = settleListen();
    renderHook(() => useMokeCommandListener(['bookA-1']));
    resolve();
    await flushMicrotasks();

    // view not ready yet: no success receipt
    expect(emitReaderEventMock).not.toHaveBeenCalled();

    // The primary view attaches and is marked inited → restore command fires.
    readerState.viewStates['bookA-1'] = {
      view: viewLike(),
      inited: true,
      isPrimary: true,
    };
    readerSubscribers.forEach((fn) => fn(readerState));

    await flushMicrotasks();
    expect(beginMokeAnnotationNavigationMock).toHaveBeenCalledTimes(1);
    expect(completeMokeAnnotationNavigationMock).toHaveBeenCalledTimes(1);
    expect(emitReaderEventMock).toHaveBeenCalledWith(
      'command:result',
      expect.objectContaining({
        request_id: 'moke-restore-progress',
        success: true,
      }),
    );
  });

  it('does not give up at the old 5s cap when the view never attaches', () => {
    vi.useFakeTimers();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.__MOKE_RESTORE_PROGRESS = { fraction: 0.5 };
    const { resolve } = settleListen();
    renderHook(() => useMokeCommandListener(['bookA-1']));
    resolve();

    // Primary view never attaches. Old behavior gave up after 20×250ms = 5s;
    // the new one uses backoff (up to 4s per attempt) across up to 60 attempts,
    // so a 5s window must NOT be the end.
    vi.advanceTimersByTime(5000);
    expect(emitReaderEventMock).not.toHaveBeenCalled();

    // After the (much larger) budget is exhausted, report the failure once and
    // mark the session as handled so later book opens don't replay stale data.
    vi.runAllTimers();
    const results = emitReaderEventMock.mock.calls.filter((call) => call[0] === 'command:result');
    expect(results.length).toBe(1);
    expect(results[0]?.[1]).toEqual(expect.objectContaining({ success: false }));
    vi.useRealTimers();
  });
});
