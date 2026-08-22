import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { BookNote } from '@/types/book';

/** A valid external annotation that can only be grouped by chapter. */
export const isChapterOnlyBookNote = (note: Pick<BookNote, 'cfi' | 'source'>): boolean =>
  !note.cfi && note.source?.degraded === true;

/** Preserve safe HTML and MathML while stripping executable note markup. */
export const sanitizeRenderedBookNoteHtml = (html: string): string =>
  DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_TAGS: ['semantics', 'annotation'],
    ADD_ATTR: ['encoding'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['srcset'],
    ALLOW_DATA_ATTR: false,
  });

/** Render note Markdown while stripping executable HTML from external sources. */
export const renderBookNoteHtml = (note?: string): string =>
  note ? sanitizeRenderedBookNoteHtml(marked.parse(note) as string) : '';
