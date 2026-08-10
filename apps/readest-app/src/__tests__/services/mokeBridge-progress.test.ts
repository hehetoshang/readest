import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The reader persists progress to the Moke server through the Tauri HTTP
// plugin. Stub it so the unit environment stays free of Tauri internals.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: fetchMock }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import { emitReaderEvent } from '@/services/mokeBridge';

const SERVER_URL = 'http://192.168.1.5:8080';

describe('mokeBridge server-side progress persistence', () => {
  const browserFetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 200 } as Response);
    window.__MOKE_EMBEDDED = true;
    window.__MOKE_SERVER_URL = SERVER_URL;
    window.__MOKE_BOOK_ID = '42';
    window.__TALEBOOK_EMBEDDED = false;
    browserFetchMock.mockReset();
    browserFetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ err: 'ok' }) });
    vi.stubGlobal('fetch', browserFetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.__MOKE_SERVER_URL = null;
    window.__MOKE_BOOK_ID = null;
    window.__TALEBOOK_EMBEDDED = false;
    vi.unstubAllGlobals();
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

  it('uses same-origin browser fetch for Talebook embedded progress', async () => {
    window.__TALEBOOK_EMBEDDED = true;

    void emitReaderEvent('page:changed', {
      book_id: 'abc123',
      location: 'epubcfi(/6/8)',
      page: 8,
    });
    await vi.advanceTimersByTimeAsync(1300);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(browserFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = browserFetchMock.mock.calls[0]!;
    expect(url).toBe(`${window.location.origin}/api/book/42/progress`);
    expect((init as RequestInit).credentials).toBe('same-origin');
    expect((init as RequestInit).keepalive).toBe(true);
  });
});
