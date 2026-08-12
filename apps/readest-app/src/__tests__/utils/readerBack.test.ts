import { describe, expect, it, vi } from 'vitest';

import { closeReaderAndNavigateBack } from '@/utils/readerBack';

describe('closeReaderAndNavigateBack', () => {
  it('waits for progress persistence before navigating back', async () => {
    let finishSaving: (() => void) | undefined;
    const closeReader = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSaving = resolve;
        }),
    );
    const navigateBack = vi.fn();

    const closing = closeReaderAndNavigateBack(closeReader, navigateBack);
    await Promise.resolve();

    expect(closeReader).toHaveBeenCalledTimes(1);
    expect(navigateBack).not.toHaveBeenCalled();

    finishSaving?.();
    await closing;

    expect(navigateBack).toHaveBeenCalledTimes(1);
  });

  it('still navigates back when a best-effort save fails', async () => {
    const navigateBack = vi.fn();

    await expect(
      closeReaderAndNavigateBack(() => Promise.reject(new Error('disk unavailable')), navigateBack),
    ).rejects.toThrow('disk unavailable');

    expect(navigateBack).toHaveBeenCalledTimes(1);
  });
});
