import { describe, expect, test } from 'vitest';

import { shouldMountNotebook } from '@/app/reader/components/notebook/notebookVisibility';

describe('lazy reader notebook', () => {
  test.each([
    { visible: false, pinned: false, expected: false },
    { visible: true, pinned: false, expected: true },
    { visible: false, pinned: true, expected: true },
  ])('mounts only when visible or pinned: $visible/$pinned', ({ visible, pinned, expected }) => {
    expect(shouldMountNotebook(visible, pinned)).toBe(expected);
  });
});
