import { TALEBOOK_EMBED_CAPABILITIES, type ReaderCapabilities } from './capabilities';

export type ReaderBootstrap = {
  schema: 'talebook.reader.bootstrap.v1';
  engine: 'readest';
  book: { id: number; title: string; format: 'epub'; revision: string };
  resource: {
    kind: 'authorized-epub-url';
    url: string;
    mime: 'application/epub+zip';
    range: true;
  };
  navigation: { back: string; fallback: string };
  capabilities: ReaderCapabilities;
};

const safeSameOriginPath = (value: string) => {
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin) throw new Error('Cross-origin reader URL rejected');
  return `${url.pathname}${url.search}${url.hash}`;
};

export class TalebookHostAdapter {
  readonly bookId: number;

  constructor(search = window.location.search) {
    const raw = new URLSearchParams(search).get('book');
    if (!raw || !/^\d+$/.test(raw)) throw new Error('Missing or invalid book id');
    this.bookId = Number(raw);
  }

  async bootstrap(): Promise<ReaderBootstrap> {
    const response = await fetch(`/api/book/${this.bookId}/reader-bootstrap?engine=readest`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Reader bootstrap failed (${response.status})`);
    const payload = (await response.json()) as ReaderBootstrap & { err?: string };
    if (payload.err !== 'ok' || payload.schema !== 'talebook.reader.bootstrap.v1') {
      throw new Error('Invalid reader bootstrap response');
    }
    if (payload.engine !== 'readest' || payload.book.format !== 'epub') {
      throw new Error('Unsupported reader bootstrap');
    }
    payload.resource.url = safeSameOriginPath(payload.resource.url);
    payload.navigation.back = safeSameOriginPath(payload.navigation.back);
    payload.navigation.fallback = safeSameOriginPath(payload.navigation.fallback);
    payload.capabilities = TALEBOOK_EMBED_CAPABILITIES;
    return payload;
  }
}
