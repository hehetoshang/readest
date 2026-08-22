import { describe, expect, test } from 'vitest';
import { enforceBookResourcePolicy } from '@/services/bookContentSecurity';

describe('enforceBookResourcePolicy', () => {
  test('blocks external JavaScript resources even when the loader initially allows them', () => {
    const detail = { isScript: true, allow: true };

    enforceBookResourcePolicy(detail);

    expect(detail.allow).toBe(false);
  });

  test('does not change non-script resources', () => {
    const detail = { isScript: false, allow: true };

    enforceBookResourcePolicy(detail);

    expect(detail.allow).toBe(true);
  });
});
