import { marked } from 'marked';
import type { BookNote } from '@/types/book';
import { sanitizeHtml } from '@/utils/sanitize';

/** A valid external annotation that can only be grouped by chapter. */
export const isChapterOnlyBookNote = (note: Pick<BookNote, 'cfi' | 'source'>): boolean =>
  !note.cfi && note.source?.degraded === true;

/** Render note Markdown while stripping executable HTML from external sources. */
export const renderBookNoteHtml = (note?: string): string =>
  note ? sanitizeHtml(marked.parse(note) as string) : '';
