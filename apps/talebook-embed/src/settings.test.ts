import { describe, expect, it } from 'vitest';
import { DEFAULT_READER_SETTINGS, loadReaderSettings, saveReaderSettings } from './settings';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  value: string | null = null;
  getItem() {
    return this.value;
  }
  setItem(_key: string, value: string) {
    this.value = value;
  }
}

describe('local reader settings', () => {
  it('uses safe defaults for corrupt or out-of-range values', () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      fontSize: 200,
      fontWeight: 123,
      fontFamily: 'remote-font',
      flow: 'unknown',
      theme: 'custom-image',
      uiLanguage: 'fr',
    });

    expect(loadReaderSettings(storage)).toEqual(DEFAULT_READER_SETTINGS);
  });

  it('round trips supported local-only settings', () => {
    const storage = new MemoryStorage();
    const settings = { ...DEFAULT_READER_SETTINGS, fontSize: 22, flow: 'scrolled' as const };
    saveReaderSettings(settings, storage);
    expect(loadReaderSettings(storage)).toEqual(settings);
  });
});
