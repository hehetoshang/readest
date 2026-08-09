import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The reader persists progress to the Moke server through the Tauri HTTP
// plugin. Stub it so the unit environment stays free of Tauri internals.
const { fetchMock, invokeMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  invokeMock: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: fetchMock }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { emitReaderEvent, __resetMokeBridgeProgressForTests } from '@/services/mokeBridge';

const SERVER_URL = 'http://192.168.1.5:8080';

describe('mokeBridge server-side progress persistence', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 200 } as Response);
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    window.__MOKE_EMBEDDED = true;
    window.__MOKE_SERVER_URL = SERVER_URL;
    window.__MOKE_BOOK_ID = '42';
    __resetMokeBridgeProgressForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.__MOKE_SERVER_URL = null;
    window.__MOKE_BOOK_ID = null;
    window.__MOKE_EMBEDDED = false;
  });

  it('posts page:changed progress to the Moke server after the debounce window', async () => {
    void emitReaderEvent('page:changed', {
      book_id: 'abc123',
      view_key: 'abc123-1',
      location: 'epubcfi(/6/4!/4/2)',
      page: 12,
      total_pages: 100,
      progress: 12,
      fraction: 0.12,
      section_href: 'chapter-2.xhtml',
      chapter: '第二章',
    });

    await vi.advanceTimersByTimeAsync(1300);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    const url = call[0];
    const init = call[1];
    expect(url).toBe(`${SERVER_URL}/api/book/42/progress`);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).credentials).toBe('include');

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.progress.schema).toBe('moke.readest.progress.v1');
    expect(body.progress.reader).toBe('readest');
    expect(body.progress.moke_book_id).toBe('42');
    expect(body.progress.reader_book_id).toBe('abc123');
    expect(body.progress.view_key).toBe('abc123-1');
    expect(body.progress.location).toBe('epubcfi(/6/4!/4/2)');
    expect(body.progress.page).toBe(12);
    expect(body.progress.total_pages).toBe(100);
    expect(body.progress.fraction).toBe(0.12);
    expect(body.progress.section_href).toBe('chapter-2.xhtml');
    expect(body.progress.chapter).toBe('第二章');
    expect(typeof body.progress.updated_at).toBe('string');
  });

  it('does not persist when no server URL is forwarded', async () => {
    window.__MOKE_SERVER_URL = null;

    void emitReaderEvent('page:changed', {
      book_id: 'abc123',
      location: 'epubcfi(/6/4!/4/2)',
    });

    await vi.advanceTimersByTimeAsync(1300);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('debounces rapid page turns and saves only the latest location', async () => {
    void emitReaderEvent('page:changed', { book_id: 'abc123', location: 'epubcfi(/6/1)', page: 1 });
    await vi.advanceTimersByTimeAsync(400);
    void emitReaderEvent('page:changed', { book_id: 'abc123', location: 'epubcfi(/6/2)', page: 2 });
    await vi.advanceTimersByTimeAsync(400);
    void emitReaderEvent('page:changed', { book_id: 'abc123', location: 'epubcfi(/6/3)', page: 3 });

    await vi.advanceTimersByTimeAsync(1300);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    const init = call[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.progress.location).toBe('epubcfi(/6/3)');
    expect(body.progress.page).toBe(3);
  });

  it('flushes pending progress when the book closes', async () => {
    void emitReaderEvent('page:changed', {
      book_id: 'abc123',
      location: 'epubcfi(/6/4!/4/2)',
      page: 7,
    });

    await emitReaderEvent('book:closed', { book_id: 'abc123' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    const url = call[0];
    expect(url).toBe(`${SERVER_URL}/api/book/42/progress`);
  });

  it('flushes a pending throttled page:changed before book:closed', async () => {
    window.__MOKE_SERVER_URL = null;

    // _throttleEntries 是模块级状态：先冲刷可能残留的 trailing timer，
    // 让后续断言不受其他用例的节流窗口影响。
    void emitReaderEvent('page:changed', { book_id: 'reset' });
    await vi.advanceTimersByTimeAsync(600);
    invokeMock.mockClear();

    void emitReaderEvent('page:changed', { book_id: 'abc123', location: 'epubcfi(/6/1)', page: 1 });
    await vi.advanceTimersByTimeAsync(100);
    void emitReaderEvent('page:changed', { book_id: 'abc123', location: 'epubcfi(/6/2)', page: 2 });

    await emitReaderEvent('book:closed', { book_id: 'abc123' });

    const calls = invokeMock.mock.calls;
    expect(calls).toHaveLength(2);
    const events = calls.map((call) => (call[1] as { event: string }).event);
    expect(events).toEqual(['page:changed', 'book:closed']);
    const flushed = calls[0]![1] as { data: { location: string; page: number } };
    expect(flushed.data.location).toBe('epubcfi(/6/2)');
    expect(flushed.data.page).toBe(2);
  });

  it('slots pending progress per book in a multi-book session', async () => {
    window.__MOKE_BOOK_ID = '42';
    void emitReaderEvent('book:opened', { book_id: 'abc123', view_key: 'abc123-1' });
    window.__MOKE_BOOK_ID = '7';
    void emitReaderEvent('book:opened', { book_id: 'def456', view_key: 'def456-1' });

    void emitReaderEvent('page:changed', {
      book_id: 'abc123',
      view_key: 'abc123-1',
      location: 'epubcfi(/6/1)',
      page: 1,
    });
    void emitReaderEvent('page:changed', {
      book_id: 'def456',
      view_key: 'def456-1',
      location: 'epubcfi(/6/2)',
      page: 2,
    });

    await vi.advanceTimersByTimeAsync(1300);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toContain(`${SERVER_URL}/api/book/42/progress`);
    expect(urls).toContain(`${SERVER_URL}/api/book/7/progress`);
    const bookA = fetchMock.mock.calls.find(
      (call) => call[0] === `${SERVER_URL}/api/book/42/progress`,
    )!;
    const bodyA = JSON.parse((bookA[1] as RequestInit).body as string);
    expect(bodyA.progress.reader_book_id).toBe('abc123');
    const bookB = fetchMock.mock.calls.find(
      (call) => call[0] === `${SERVER_URL}/api/book/7/progress`,
    )!;
    const bodyB = JSON.parse((bookB[1] as RequestInit).body as string);
    expect(bodyB.progress.reader_book_id).toBe('def456');
  });

  it('book:closed flushes only the closed book, keeping siblings pending', async () => {
    window.__MOKE_BOOK_ID = '42';
    void emitReaderEvent('book:opened', { book_id: 'abc123', view_key: 'abc123-1' });
    window.__MOKE_BOOK_ID = '7';
    void emitReaderEvent('book:opened', { book_id: 'def456', view_key: 'def456-1' });

    void emitReaderEvent('page:changed', {
      book_id: 'abc123',
      view_key: 'abc123-1',
      location: 'epubcfi(/6/1)',
      page: 1,
    });
    void emitReaderEvent('page:changed', {
      book_id: 'def456',
      view_key: 'def456-1',
      location: 'epubcfi(/6/2)',
      page: 2,
    });

    await emitReaderEvent('book:closed', { book_id: 'abc123', view_key: 'abc123-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${SERVER_URL}/api/book/42/progress`);

    await vi.advanceTimersByTimeAsync(1300);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toBe(`${SERVER_URL}/api/book/7/progress`);
  });

  it('stops direct-saving for the session after one 404 from the server', async () => {
    fetchMock.mockResolvedValueOnce({ status: 404 } as Response);

    void emitReaderEvent('page:changed', { book_id: 'abc123', location: 'epubcfi(/6/1)', page: 1 });
    await vi.advanceTimersByTimeAsync(1300);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A second debounce window must not hit the server again this session.
    void emitReaderEvent('page:changed', { book_id: 'abc123', location: 'epubcfi(/6/2)', page: 2 });
    await vi.advanceTimersByTimeAsync(1300);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Closing the book should not flush to the unsupported API either.
    await emitReaderEvent('book:closed', { book_id: 'abc123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('flushes pending progress synchronously on pagehide', async () => {
    void emitReaderEvent('page:changed', { book_id: 'abc123', location: 'epubcfi(/6/1)', page: 1 });
    expect(fetchMock).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${SERVER_URL}/api/book/42/progress`);
  });

  it('flushes pending progress synchronously when the page is hidden', async () => {
    void emitReaderEvent('page:changed', { book_id: 'abc123', location: 'epubcfi(/6/1)', page: 1 });
    expect(fetchMock).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${SERVER_URL}/api/book/42/progress`);
  });
});
