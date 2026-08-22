import { afterEach, describe, expect, test } from 'vitest';
import type { ViewSettings } from '@/types/book';
import { sanitizerTransformer } from '@/services/transformers/sanitizer';

const EXECUTION_FLAG = '__READEST_UNTRUSTED_BOOK_SCRIPT_RAN__';

afterEach(() => {
  Reflect.deleteProperty(window, EXECUTION_FLAG);
  document.querySelectorAll('iframe[data-book-script-test]').forEach((frame) => frame.remove());
});

describe('book script blocking', () => {
  test('sanitized publication content cannot execute in the same-origin Foliate sandbox', async () => {
    const content = await sanitizerTransformer.transform({
      bookKey: 'malicious-book',
      viewSettings: { allowScript: true } as ViewSettings,
      userLocale: 'en',
      isFixedLayout: false,
      content: `<html><body><script>parent.${EXECUTION_FLAG} = true</script><p>Safe text</p></body></html>`,
      contentType: 'application/xhtml+xml',
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
    expect(frame.contentDocument?.body.textContent).toContain('Safe text');
  });
});
