declare module 'foliate-js/epub.js' {
  export class EPUB {
    constructor(loader: unknown);
    init(): Promise<unknown>;
  }
}

declare module 'foliate-js/paginator.js' {
  export class Paginator extends HTMLElement {
    open(book: unknown): void;
    next(): Promise<void>;
    prev(): Promise<void>;
    destroy(): void;
  }
}
