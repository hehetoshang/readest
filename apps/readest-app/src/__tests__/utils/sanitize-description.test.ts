import { describe, expect, test } from 'vitest';

import { sanitizeDescriptionHtml } from '@/utils/sanitize';

describe('sanitizeDescriptionHtml', () => {
  test('keeps common text formatting and strips attributes', () => {
    const html = [
      '<h2 class="cover" style="position:fixed">Synopsis</h2>',
      '<p>A <strong>bold</strong> and <em>thoughtful</em> story.<br>Read on.</p>',
      '<blockquote cite="https://example.com">A quotation</blockquote>',
      '<ul><li>One</li><li><code>Two</code></li></ul>',
    ].join('');

    expect(sanitizeDescriptionHtml(html)).toBe(
      '<h2>Synopsis</h2><p>A <strong>bold</strong> and <em>thoughtful</em> story.<br>Read on.</p><blockquote>A quotation</blockquote><ul><li>One</li><li><code>Two</code></li></ul>',
    );
  });

  test('removes executable and embedded content', () => {
    const html = [
      '<script>window.pwned = true</script>',
      '<p onclick="window.pwned = true">Safe text</p>',
      '<iframe srcdoc="<script>window.pwned = true</script>"></iframe>',
      '<object data="https://tracker.example/object"></object>',
      '<embed src="https://tracker.example/embed">',
      '<meta http-equiv="refresh" content="0;url=https://tracker.example">',
      '<style>body{display:none}</style>',
    ].join('');

    const clean = sanitizeDescriptionHtml(html);
    expect(clean).toBe('<p>Safe text</p>');
    expect(clean).not.toMatch(/script|onclick|iframe|object|embed|meta|style/i);
  });

  test('removes images, navigation, and dangerous URL schemes while preserving text', () => {
    const html = [
      '<img src="https://tracker.example/pixel.gif" onerror="window.pwned = true">',
      '<img src="data:image/svg+xml,<svg onload=alert(1)></svg>">',
      '<a href="https://tracker.example">remote link</a>',
      '<a href="javascript:alert(1)">javascript link</a>',
      '<a href="data:text/html,<script>alert(1)</script>">data link</a>',
    ].join('');

    const clean = sanitizeDescriptionHtml(html);
    expect(clean).toBe('remote linkjavascript linkdata link');
    expect(clean).not.toMatch(/<img|<a|href|src|onerror|https:|javascript:|data:/i);
  });

  test('handles empty and malformed HTML', () => {
    expect(sanitizeDescriptionHtml('')).toBe('');
    expect(sanitizeDescriptionHtml('<p>First<strong>bold</p>tail')).toBe(
      '<p>First<strong>bold</strong></p><strong>tail</strong>',
    );
  });
});
