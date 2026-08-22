import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useBooksSync } from '@/app/library/hooks/useBooksSync';

describe('useBooksSync in Moke', () => {
  it('keeps Readest Cloud pull and push disabled', async () => {
    const { result } = renderHook(() => useBooksSync());

    await act(async () => {
      await expect(result.current.pullLibrary(true, true)).resolves.toBeUndefined();
      await expect(result.current.pushLibrary()).resolves.toBeUndefined();
    });
  });
});
