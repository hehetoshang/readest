import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import type { AppService } from '@/types/system';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
}));

vi.mock('@tauri-apps/api/path', () => ({
  basename: vi.fn(async (path: string) =>
    path.includes('font-1') ? 'My Custom Font.TTF' : 'notes.txt',
  ),
}));

import { useFileSelector } from '@/hooks/useFileSelector';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useFileSelector', () => {
  test('opens Android font picker without MIME extension filters and filters selected files afterward', async () => {
    const selectFiles = vi
      .fn<(...args: unknown[]) => Promise<string[]>>()
      .mockResolvedValue([
        'content://com.android.providers.media.documents/document/font-1',
        'content://com.android.providers.media.documents/document/not-font',
      ]);
    const appService = {
      isAndroidApp: true,
      isIOSApp: false,
      selectFiles,
    } as unknown as AppService;

    const { result } = renderHook(() => useFileSelector(appService, (key) => key));
    const selected = await result.current.selectFiles({ type: 'fonts', multiple: true });

    expect(selectFiles).toHaveBeenCalledWith('Select Fonts', []);
    expect(selected.error).toBeUndefined();
    expect(selected.files).toEqual([
      {
        path: 'content://com.android.providers.media.documents/document/font-1',
        name: 'My Custom Font.TTF',
      },
    ]);
  });
});
