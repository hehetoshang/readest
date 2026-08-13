import { Paginator } from 'foliate-js/paginator.js';

export class ReaderView extends EventTarget {
  readonly element: Paginator;

  constructor() {
    super();
    this.element = new Paginator();
    this.element.setAttribute('flow', 'paginated');
    this.element.addEventListener('relocate', (event) => {
      this.dispatchEvent(new CustomEvent('relocate', { detail: (event as CustomEvent).detail }));
    });
  }

  open(book: unknown) {
    this.element.open(book);
    return this.element.next();
  }

  next() {
    return this.element.next();
  }
  previous() {
    return this.element.prev();
  }
  close() {
    this.element.destroy();
  }
}
