import { describe, it, expect } from 'vitest';

import { resolveMokeRuntimePlatform } from '@/utils/mokePlatform';

const OHOS_UA =
  'Mozilla/5.0 (Phone; OpenHarmony 5.0.0) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/114.0.0.0 Safari/537.36 ArkWeb/4.1.6.1';

describe('resolveMokeRuntimePlatform', () => {
  it('trusts the native probe result', () => {
    expect(resolveMokeRuntimePlatform('linux', 'linux', OHOS_UA)).toBe('linux');
    expect(resolveMokeRuntimePlatform('windows', 'linux', OHOS_UA)).toBe('windows');
    expect(resolveMokeRuntimePlatform('ohos', 'linux', OHOS_UA)).toBe('ohos');
  });

  it('treats a linux fallback on an ArkWeb/OpenHarmony UA as OHOS (single WebView)', () => {
    expect(resolveMokeRuntimePlatform(null, 'linux', OHOS_UA)).toBe('ohos');
    expect(resolveMokeRuntimePlatform(null, 'linux', 'Mozilla/5.0 ArkWeb/4.0')).toBe('ohos');
  });

  it('keeps a linux fallback on a desktop UA as desktop', () => {
    const desktopLinuxUA =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
    expect(resolveMokeRuntimePlatform(null, 'linux', desktopLinuxUA)).toBe('linux');
  });

  it('passes through other fallback platforms unchanged', () => {
    expect(resolveMokeRuntimePlatform(null, 'android', 'Android UA')).toBe('android');
    expect(resolveMokeRuntimePlatform(null, 'ios', 'iPhone UA')).toBe('ios');
    expect(resolveMokeRuntimePlatform(null, 'windows', 'Windows UA')).toBe('windows');
  });
});
