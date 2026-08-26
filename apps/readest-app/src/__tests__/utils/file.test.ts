import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemoteFile } from '@/utils/file';

// RemoteFile.fromNativePath serves a local file through the `rangefile` custom
// URI scheme, carrying the byte range in the URL query (?start=&end=) rather
// than a `Range` header — because Android's WebView re-applies a `Range`
// header's offset to intercepted bodies and corrupts non-zero-start reads.
describe('RemoteFile.fromNativePath (rangefile query-range scheme)', () => {
  const path = '/data/user/0/com.bilingify.readest/cache/堂吉诃德（译文名著典藏）.mobi';
  const TOTAL = 10371956;
  let calls: Array<{ url: string; init?: RequestInit }>;
  let data: Uint8Array;

  beforeEach(() => {
    calls = [];
    data = new Uint8Array(8192);
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const u = new URL(url);
      const start = Number(u.searchParams.get('start') ?? 0);
      const end = Number(u.searchParams.get('end') ?? 0);
      const body = data.slice(start, Math.min(end + 1, data.length));
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          'X-Total-Size': String(TOTAL),
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(body.length),
        }),
        arrayBuffer: async () =>
          body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const noRangeHeader = () =>
    calls.every((c) => {
      const h = c.init?.headers as Record<string, string> | undefined;
      return !h || !Object.keys(h).some((k) => k.toLowerCase() === 'range');
    });

  it('builds a rangefile.localhost URL with the path percent-encoded in the query', () => {
    const f = RemoteFile.fromNativePath(path, 'book.mobi');
    expect(f.url).toBe(`http://rangefile.localhost/?path=${encodeURIComponent(path)}`);
    expect(f.name).toBe('book.mobi');
  });

  it('open() reads the size from X-Total-Size and sends NO Range header', async () => {
    const f = await RemoteFile.fromNativePath(path).open();
    expect(f.size).toBe(TOTAL);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('start=0');
    expect(calls[0]!.url).toContain('end=0');
    expect(noRangeHeader()).toBe(true);
  });

  it('fetchRangePart() carries the range in the query, not a Range header', async () => {
    const f = await RemoteFile.fromNativePath(path).open();
    calls.length = 0;
    const buf = await f.fetchRangePart(1024, 2047);
    expect(buf.byteLength).toBe(1024);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get('start')).toBe('1024');
    expect(u.searchParams.get('end')).toBe('2047');
    expect(noRangeHeader()).toBe(true);
    // bytes must be the real [1024,2047] slice (proves no offset re-application)
    expect(new Uint8Array(buf)[0]).toBe(1024 & 0xff);
  });

  it('slice().arrayBuffer() returns the correct bytes for a non-zero offset', async () => {
    const f = await RemoteFile.fromNativePath(path).open();
    const buf = await f.slice(2000, 2010).arrayBuffer(); // [2000, 2010)
    expect(buf.byteLength).toBe(10);
    expect(new Uint8Array(buf)[0]).toBe(2000 & 0xff);
    expect(noRangeHeader()).toBe(true);
  });

  it('rejects a failed rangefile response instead of accepting an unreadable book', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: new Headers(),
    })) as unknown as typeof fetch;

    await expect(RemoteFile.fromNativePath(path).open()).rejects.toThrow(
      'Failed to fetch file size: 403',
    );
  });

  it.each([
    null,
    '',
    '-1',
    'NaN',
    '3.14',
  ])('rejects an invalid X-Total-Size header (%s)', async (sizeHeader) => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(sizeHeader === null ? {} : { 'X-Total-Size': sizeHeader }),
    })) as unknown as typeof fetch;

    await expect(RemoteFile.fromNativePath(path).open()).rejects.toThrow(
      'Invalid X-Total-Size from rangefile protocol',
    );
  });

  it('times out a rangefile request that never responds', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    ) as unknown as typeof fetch;

    const opening = RemoteFile.fromNativePath(path).open();
    const assertion = expect(opening).rejects.toThrow(
      'Timed out waiting for rangefile protocol response',
    );
    await vi.advanceTimersByTimeAsync(RemoteFile.RANGE_FETCH_TIMEOUT_MS);
    await assertion;
  });

  it('resolves concurrent non-zero ranges without mixing their bytes', async () => {
    const f = await RemoteFile.fromNativePath(path).open();
    calls.length = 0;
    const ranges = [
      [128, 255],
      [1024, 1151],
      [4096, 4223],
      [7000, 7127],
    ] as const;

    const buffers = await Promise.all(ranges.map(([start, end]) => f.fetchRangePart(start, end)));

    expect(buffers).toHaveLength(ranges.length);
    buffers.forEach((buffer, index) => {
      expect(buffer.byteLength).toBe(128);
      expect(new Uint8Array(buffer)[0]).toBe(ranges[index]![0] & 0xff);
    });
    expect(noRangeHeader()).toBe(true);
  });
});
