import { describe, expect, it } from 'vitest';
import { loadPosition, positionFromHash, savePosition } from './position';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  value: string | null = null;
  getItem() {
    return this.value;
  }
  setItem(_key: string, value: string) {
    this.value = value;
  }
}

describe('local reading position', () => {
  it('restores only a position for the current resource revision', () => {
    const storage = new MemoryStorage();
    savePosition(7, 'rev-a', 'epubcfi(/6/2!/4/2)', storage);
    expect(loadPosition(7, 'rev-a', storage)).toBe('epubcfi(/6/2!/4/2)');
    expect(loadPosition(7, 'rev-b', storage)).toBeNull();
  });

  it('accepts only bounded CFI deep links', () => {
    expect(positionFromHash('#loc=epubcfi(%2F6%2F2!%2F4%2F2)')).toBe('epubcfi(/6/2!/4/2)');
    expect(positionFromHash('#loc=https%3A%2F%2Fexample.com')).toBeNull();
  });
});
