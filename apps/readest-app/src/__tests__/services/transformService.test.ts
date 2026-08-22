import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ViewSettings } from '@/types/book';
import { sanitizerTransformer } from '@/services/transformers/sanitizer';
import type { TransformContext } from '@/services/transformers/types';
import { transformContent } from '@/services/transformService';

vi.mock('@/utils/simplecc', () => ({
  initSimpleCC: vi.fn(),
  runSimpleCC: vi.fn((text: string) => text),
}));

function makeCtx(overrides: Partial<TransformContext> = {}): TransformContext {
  return {
    bookKey: 'test-book',
    viewSettings: { allowScript: false } as ViewSettings,
    userLocale: 'en',
    isFixedLayout: false,
    content: '',
    transformers: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('transformContent', () => {
  test('rejects instead of returning unsanitized content when the sanitizer fails', async () => {
    const unsafeContent = '<html><body><script>alert("xss")</script></body></html>';
    const sanitizerError = new Error('Sanitizer failed');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(sanitizerTransformer, 'transform').mockRejectedValueOnce(sanitizerError);

    await expect(
      transformContent(
        makeCtx({
          content: unsafeContent,
          transformers: ['sanitizer'],
        }),
      ),
    ).rejects.toBe(sanitizerError);
  });
});
