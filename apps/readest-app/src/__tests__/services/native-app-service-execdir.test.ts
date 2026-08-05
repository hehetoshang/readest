import { describe, test, expect, vi, beforeEach } from 'vitest';

// Moke's single-WebView integration (OHOS) does not register readest's own
// backend commands (they are desktop-only). `get_executable_dir` is invoked
// at the very start of NativeAppService.init() and currently throws
// "Command get_executable_dir not found", which breaks the reader startup.
// This test locks in graceful degradation: init() must not throw and the
// service must stay non-portable.

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(true),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readTextFile: vi.fn().mockResolvedValue('{}'),
  readFile: vi.fn().mockResolvedValue(new Uint8Array()),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ isFile: () => true, isDir: () => false }),
  BaseDirectory: {},
  WriteFileOptions: {},
  DirEntry: {},
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: async (...parts: string[]) => parts.join('/'),
  basename: async (p: string) => p.split('/').pop() ?? '',
  appDataDir: async () => '/data/app',
  appConfigDir: async () => '/data/app',
  appCacheDir: async () => '/data/cache',
  appLogDir: async () => '/data/log',
  tempDir: async () => '/tmp',
}));

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
  ask: vi.fn(),
}));
vi.mock('@choochmeque/tauri-plugin-sharekit-api', () => ({ shareFile: vi.fn() }));

import { NativeAppService } from '@/services/nativeAppService';

describe('NativeAppService on single-WebView runtimes (no readest backend commands)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string) => {
      // OHOS: readest's own commands are not registered
      if (cmd === 'get_executable_dir') {
        return Promise.reject(new Error('Command get_executable_dir not found'));
      }
      return Promise.resolve(null);
    });
  });

  test('init() degrades gracefully when get_executable_dir is unavailable', async () => {
    const svc = new NativeAppService();
    await expect(svc.init()).resolves.not.toThrow();
    // No execDir means portable detection must be skipped
    expect(svc.isPortableApp).toBe(false);
  });
});
