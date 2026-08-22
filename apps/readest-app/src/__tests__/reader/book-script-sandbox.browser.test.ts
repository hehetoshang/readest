import { afterEach, describe, expect, test } from 'vitest';
import { getBookContentPolicy } from '@/services/bookContentSecurity';
import { sanitizerTransformer } from '@/services/transformers/sanitizer';
import type { ViewSettings } from '@/types/book';

const EXECUTION_FLAG = '__READEST_UNTRUSTED_BOOK_SCRIPT_RAN__';

afterEach(() => {
  Reflect.deleteProperty(window, EXECUTION_FLAG);
  document.querySelectorAll('iframe[data-book-script-test]').forEach((frame) => frame.remove());
});

describe('book script blocking', () => {
  test.each([
    {
      name: 'parameterized XHTML MIME',
      contentType: 'application/xhtml+xml; charset=utf-8',
      resourceName: 'Text/chapter.xhtml',
      source: `<html><body><script>parent.${EXECUTION_FLAG} = true</script><p>Safe XHTML</p></body></html>`,
      readableText: 'Safe XHTML',
    },
    {
      name: 'case-variant SVG MIME',
      contentType: 'Image/SVG+XML',
      resourceName: 'Images/page.svg',
      source: `<svg xmlns="http://www.w3.org/2000/svg"><script>parent.${EXECUTION_FLAG} = true</script><text>Safe SVG</text></svg>`,
      readableText: 'Safe SVG',
    },
    {
      name: 'missing document MIME',
      contentType: undefined,
      resourceName: 'Text/missing.xhtml',
      source: `<html><body><script>parent.${EXECUTION_FLAG} = true</script><p>Safe missing MIME</p></body></html>`,
      readableText: 'Safe missing MIME',
    },
    {
      name: 'unknown document MIME',
      contentType: 'application/x-unknown-document',
      resourceName: 'Text/unknown.xhtml',
      source: `<html><body><script>parent.${EXECUTION_FLAG} = true</script><p>Safe unknown MIME</p></body></html>`,
      readableText: 'Safe unknown MIME',
    },
  ])('$name cannot execute in the same-origin Foliate sandbox', async (testCase) => {
    const policy = getBookContentPolicy(testCase.contentType, testCase.resourceName);
    expect(policy.kind).toBe('document');
    if (policy.kind !== 'document') throw new Error('Expected publication document policy');

    const content = await sanitizerTransformer.transform({
      bookKey: 'malicious-book',
      viewSettings: { allowScript: true } as ViewSettings,
      userLocale: 'en',
      isFixedLayout: false,
      content: testCase.source,
      contentType: policy.contentType,
      transformers: ['sanitizer'],
    });
    const frame = document.createElement('iframe');
    frame.dataset['bookScriptTest'] = 'true';
    frame.setAttribute('sandbox', 'allow-same-origin allow-scripts');
    const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve()));
    frame.srcdoc = content;
    document.body.append(frame);

    await loaded;

    expect(Reflect.get(window, EXECUTION_FLAG)).toBeUndefined();
    expect(frame.contentDocument?.body.textContent).toContain(testCase.readableText);
  });
});
