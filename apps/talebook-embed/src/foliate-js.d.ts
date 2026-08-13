declare module 'foliate-js/epub.js' {
  export class EPUB {
    constructor(loader: {
      entries: unknown;
      loadText: unknown;
      loadBlob: unknown;
      getSize: unknown;
      sha1?: unknown;
      destroy?: unknown;
    });
    init(): Promise<unknown>;
  }
}

declare module 'foliate-js/view.js' {}

type FoliateSearchItem = {
  cfi: string;
  excerpt: { pre?: string; match?: string; post?: string };
};

interface FoliateView extends HTMLElement {
  renderer?: HTMLElement & { setStyles?: (styles: string) => void };
  open(book: unknown): Promise<void>;
  init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  goTo(target: string): Promise<unknown>;
  search(options: {
    query: string;
  }): AsyncGenerator<'done' | { label: string; subitems?: FoliateSearchItem[] }>;
  clearSearch(): void;
  close(): void;
}

declare global {
  interface HTMLElementTagNameMap {
    'foliate-view': FoliateView;
  }
}

export {};
