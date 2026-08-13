import 'foliate-js/view.js';
import { readerStyles, themeColors, type ReaderSettings } from './settings';

type FoliateSearchItem = {
  cfi: string;
  excerpt: { pre?: string; match?: string; post?: string };
};

type FoliateView = HTMLElement & {
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
};

export type TocItem = Readonly<{ label?: string; href?: string; subitems?: TocItem[] }>;
export type SearchResult = Readonly<{
  cfi: string;
  label: string;
  excerpt: { pre?: string; match?: string; post?: string };
}>;
export type RelocateDetail = Readonly<{
  fraction?: number;
  tocItem?: { label?: string };
  cfi?: string;
}>;

type FoliateBook = {
  toc?: TocItem[];
  destroy?: () => void;
};

export class ReaderView extends EventTarget {
  readonly element: FoliateView;
  #book: FoliateBook | null = null;

  constructor() {
    super();
    this.element = document.createElement('foliate-view') as FoliateView;
    this.element.addEventListener('relocate', (event: Event) => {
      this.dispatchEvent(new CustomEvent('relocate', { detail: (event as CustomEvent).detail }));
    });
    // External EPUB links are never opened by the embed. This also prevents
    // the library's default popup path from becoming a network escape hatch.
    this.element.addEventListener('external-link', (event: Event) => event.preventDefault());
  }

  async open(book: FoliateBook, settings: ReaderSettings, position?: string | null) {
    this.#book = book;
    await this.element.open(book);
    this.applySettings(settings);
    await this.element.init({ lastLocation: position ?? undefined, showTextStart: !position });
  }

  get toc() {
    return this.#book?.toc ?? [];
  }

  applySettings(settings: ReaderSettings) {
    const renderer = this.element.renderer;
    renderer?.setAttribute('flow', settings.flow);
    renderer?.setAttribute('margin-top', String(settings.margin));
    renderer?.setAttribute('margin-right', String(settings.margin));
    renderer?.setAttribute('margin-bottom', String(settings.margin));
    renderer?.setAttribute('margin-left', String(settings.margin));
    renderer?.setAttribute('max-column-count', String(settings.columns));
    renderer?.setStyles?.(readerStyles(settings));
    const colors = themeColors(settings.theme);
    this.element.style.background = colors.background;
    this.element.style.color = colors.foreground;
  }

  next() {
    return this.element.next();
  }
  previous() {
    return this.element.prev();
  }
  goTo(target: string) {
    return this.element.goTo(target);
  }

  async search(query: string): Promise<SearchResult[]> {
    const term = query.trim();
    if (!term) {
      this.element.clearSearch();
      return [];
    }
    const output: SearchResult[] = [];
    for await (const item of this.element.search({ query: term })) {
      if (item === 'done' || !item.subitems) continue;
      for (const result of item.subitems) {
        output.push({ cfi: result.cfi, label: item.label, excerpt: result.excerpt });
      }
    }
    return output.slice(0, 200);
  }

  close() {
    this.element.close();
    this.#book?.destroy?.();
    this.#book = null;
  }
}
