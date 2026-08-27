import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const platformMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-os', () => ({ platform: platformMock }));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: fetchMock }));

const pushMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/utils/book', () => ({ formatTitle: (title: string) => title }));

vi.mock('@/utils/tauriEpubBridge', () => ({ tryNativeParseEpub: () => Promise.resolve(null) }));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalViewSettings: { isEink: false } } }),
}));

vi.mock('@/components/Spinner', () => ({ default: () => null }));

import MokeDownloads from '@/app/library/components/MokeDownloads';

const BOOKS = [
  {
    id: 'dl-1',
    bookId: '42',
    title: 'Book A',
    fileName: 'a.epub',
    filePath: '/data/books/a.epub',
  },
  {
    id: 'legacy:x.epub',
    bookId: '',
    title: 'Legacy Book',
    fileName: 'x.epub',
    filePath: '/data/books/x.epub',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  window.__MOKE_SERVER_URL = 'http://192.168.1.5:8080';
  window.__MOKE_ALLOW_INVALID_CERTIFICATE = false;
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === 'moke_list_downloaded_books') return BOOKS;
    if (cmd === 'moke_runtime_platform') return 'ohos';
    if (cmd === 'moke_navigate') return undefined;
    throw new Error(`unexpected invoke ${cmd}`);
  });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    json: () =>
      Promise.resolve({ progress: { schema: 'moke.readest.progress.v1', location: 'page=12' } }),
  } as Response);
});

afterEach(() => {
  cleanup();
  window.__MOKE_SERVER_URL = null;
  window.__MOKE_ALLOW_INVALID_CERTIFICATE = false;
});

// ---------------------------------------------------------------------------
// H20-M4: mobile must use moke_navigate full-document navigation, not
// router.push + manual global seeding.
// ---------------------------------------------------------------------------

describe('MokeDownloads mobile open (H20-M4)', () => {
  it('navigates via moke_navigate with progress/book/server seeded in the URL', async () => {
    render(<MokeDownloads searchQuery='' />);
    await screen.findByText('Book A');

    fireEvent.click(screen.getByText('Book A'));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('moke_navigate', expect.any(Object)),
    );

    const navCall = invokeMock.mock.calls.find(([cmd]) => cmd === 'moke_navigate')!;
    const path = (navCall[1] as { path: string }).path;
    const url = new URL(`https://host.invalid${path}`);

    expect(url.pathname).toBe('/readest/reader');
    expect(url.searchParams.get('file')).toBe('/data/books/a.epub');
    expect(url.searchParams.get('moke')).toBe('1');
    expect(url.searchParams.get('mokeBookId')).toBe('42');
    expect(url.searchParams.get('mokeServerUrl')).toBe('http://192.168.1.5:8080');
    expect(url.searchParams.get('mokeRestoreProgress')).toContain('page=12');
    // No manual global seeding on mobile anymore — the launch script parses the URL.
    expect(pushMock).not.toHaveBeenCalled();
    expect(window.__MOKE_EMBEDDED).toBeUndefined();
  });

  it('omits server/progress params for legacy books with no bookId', async () => {
    render(<MokeDownloads searchQuery='' />);
    await screen.findByText('Legacy Book');

    fireEvent.click(screen.getByText('Legacy Book'));

    await waitFor(() =>
      expect(invokeMock.mock.calls.some(([cmd]) => cmd === 'moke_navigate')).toBe(true),
    );
    const navCall = invokeMock.mock.calls.find(([cmd]) => cmd === 'moke_navigate')!;
    const url = new URL(`https://host.invalid${(navCall[1] as { path: string }).path}`);

    expect(url.searchParams.get('mokeBookId')).toBeNull();
    expect(url.searchParams.get('mokeRestoreProgress')).toBeNull();
    // serverUrl is still forwarded for progress persistence, even without a bookId.
    expect(url.searchParams.get('mokeServerUrl')).toBe('http://192.168.1.5:8080');
  });

  it('falls back to router.push when moke_navigate is unavailable', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'moke_list_downloaded_books') return BOOKS;
      if (cmd === 'moke_runtime_platform') return 'ohos';
      throw new Error('moke_navigate not available');
    });

    render(<MokeDownloads searchQuery='' />);
    await screen.findByText('Book A');

    fireEvent.click(screen.getByText('Book A'));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const href = pushMock.mock.calls[0]?.[0] as string;
    expect(href.startsWith('/reader?file=')).toBe(true);
  });
});
