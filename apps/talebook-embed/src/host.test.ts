import { describe, expect, it, vi } from 'vitest';
import { TalebookHostAdapter } from './host';

const response = (
  status: number,
  body: unknown,
  url = 'https://books.test/api/book/1/reader-bootstrap',
) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  }) as Response;

describe('Talebook host adapter', () => {
  it('maps structured host errors to actionable reader errors', async () => {
    const fetcher = vi.fn(async () => response(409, { err: 'reader.resource_changed' }));
    const host = new TalebookHostAdapter('?book=1', 'https://books.test', fetcher);
    await expect(host.bootstrap()).rejects.toMatchObject({
      code: 'resource-changed',
    });
  });

  it('rejects cross-origin resource and navigation URLs', async () => {
    const fetcher = vi.fn(async () =>
      response(200, {
        err: 'ok',
        schema: 'talebook.reader.bootstrap.v1',
        engine: 'readest',
        book: { id: 1, title: 'Book', format: 'epub', revision: 'r1' },
        resource: {
          kind: 'authorized-epub-url',
          url: 'https://evil.test/book.epub',
          mime: 'application/epub+zip',
          range: true,
        },
        navigation: { back: '/book/1', fallback: '/read/1?reader=candle' },
        capabilities: {},
      }),
    );
    const host = new TalebookHostAdapter('?book=1', 'https://books.test', fetcher);
    await expect(host.bootstrap()).rejects.toMatchObject({ code: 'invalid-bootstrap' });
  });
});
