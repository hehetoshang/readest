import { describe, expect, it } from 'vitest';
import { TALEBOOK_EMBED_CAPABILITIES } from './capabilities';

describe('talebook embed capabilities', () => {
  it('allows only the phase 0 reader surface', () => {
    const enabled = Object.entries(TALEBOOK_EMBED_CAPABILITIES)
      .filter(([, value]) => value)
      .map(([key]) => key);
    expect(enabled).toEqual(['readerCore', 'localSettings']);
  });
});
