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

export type ReaderErrorCode =
  | 'login-required'
  | 'activation-required'
  | 'permission-denied'
  | 'book-not-found'
  | 'format-unsupported'
  | 'conversion-pending'
  | 'resource-changed'
  | 'bootstrap-unavailable'
  | 'invalid-bootstrap';

export class ReaderHostError extends Error {
  constructor(
    readonly code: ReaderErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ReaderHostError';
  }
}

const ERROR_CODES: Record<string, ReaderErrorCode> = {
  'user.need_login': 'login-required',
  'user.activation_required': 'activation-required',
  'user.no_permission': 'permission-denied',
  'book.not_found': 'book-not-found',
  'reader.format_unsupported': 'format-unsupported',
  'reader.conversion_pending': 'conversion-pending',
  'reader.resource_changed': 'resource-changed',
};

export class TalebookHostAdapter {
  readonly bookId: number;

  constructor(
    search = window.location.search,
    private readonly origin = window.location.origin,
    private readonly fetcher: typeof fetch = (...args) => window.fetch(...args),
  ) {
    const raw = new URLSearchParams(search).get('book');
    if (!raw || !/^\d+$/.test(raw)) throw new ReaderHostError('invalid-bootstrap');
    this.bookId = Number(raw);
  }

  #safeSameOriginPath(value: string) {
    const url = new URL(value, this.origin);
    if (url.origin !== this.origin) throw new ReaderHostError('invalid-bootstrap');
    return `${url.pathname}${url.search}${url.hash}`;
  }

  async bootstrap(): Promise<ReaderBootstrap> {
    let response: Response;
    try {
      response = await this.fetcher(
        `${this.origin}/api/book/${this.bookId}/reader-bootstrap?engine=readest`,
        {
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'follow',
          headers: { Accept: 'application/json' },
        },
      );
    } catch (error) {
      console.error('Talebook reader bootstrap request failed', error);
      throw new ReaderHostError('bootstrap-unavailable');
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      const redirectedToLogin =
        new URL(response.url || this.origin, this.origin).pathname === '/login';
      throw new ReaderHostError(redirectedToLogin ? 'login-required' : 'bootstrap-unavailable');
    }

    let payload: ReaderBootstrap & { err?: string };
    try {
      payload = (await response.json()) as ReaderBootstrap & { err?: string };
    } catch {
      throw new ReaderHostError('invalid-bootstrap');
    }
    if (!response.ok || payload.err !== 'ok') {
      throw new ReaderHostError(ERROR_CODES[payload.err ?? ''] ?? 'bootstrap-unavailable');
    }
    if (
      payload.schema !== 'talebook.reader.bootstrap.v1' ||
      payload.engine !== 'readest' ||
      payload.book.format !== 'epub' ||
      payload.resource.kind !== 'authorized-epub-url' ||
      payload.resource.mime !== 'application/epub+zip' ||
      payload.resource.range !== true
    ) {
      throw new ReaderHostError('invalid-bootstrap');
    }
    payload.resource.url = this.#safeSameOriginPath(payload.resource.url);
    payload.navigation.back = this.#safeSameOriginPath(payload.navigation.back);
    payload.navigation.fallback = this.#safeSameOriginPath(payload.navigation.fallback);
    payload.capabilities = TALEBOOK_EMBED_CAPABILITIES;
    return payload;
  }
}
