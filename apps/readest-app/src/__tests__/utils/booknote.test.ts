import { describe, expect, it } from 'vitest';
import { isChapterOnlyBookNote, renderBookNoteHtml } from '@/utils/booknote';

describe('isChapterOnlyBookNote', () => {
  it('keeps an explicitly degraded external annotation without a CFI', () => {
    expect(
      isChapterOnlyBookNote({
        cfi: '',
        source: { name: 'weread', chapter: 'Chapter 3', degraded: true },
      }),
    ).toBe(true);
  });

  it('does not make an arbitrary empty-CFI record valid', () => {
    expect(isChapterOnlyBookNote({ cfi: '', source: undefined })).toBe(false);
  });
});

describe('renderBookNoteHtml', () => {
  it('keeps Markdown formatting while stripping executable remote HTML', () => {
    const html = renderBookNoteHtml('**safe** <img src="x" onerror="alert(1)">');

    expect(html).toContain('<strong>safe</strong>');
    expect(html).toContain('<img src="x">');
    expect(html).not.toContain('onerror');
  });
});
