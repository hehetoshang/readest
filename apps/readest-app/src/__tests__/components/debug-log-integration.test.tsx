import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const debugMocks = vi.hoisted(() => ({
  installConsoleCapture: vi.fn(),
  installDebugLogBridge: vi.fn(async () => vi.fn()),
  installNetworkCapture: vi.fn(),
  uninstallConsoleCapture: vi.fn(),
  uninstallNetworkCapture: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('@/services/debugLog', () => ({
  ...debugMocks,
  useDebugLogStore: (selector: (state: { logs: never[]; clear: () => void }) => unknown) =>
    selector({ logs: [], clear: debugMocks.clear }),
}));

vi.mock('@/helpers/mokeLaunchContext', () => ({
  readPersistedMokeDebugPanel: vi.fn(() => false),
}));

import DebugLogIntegration from '@/components/DebugLogIntegration';

const SCRIPT_TAG_WARNING = 'Encountered a script tag while rendering React component';
const HYDRATION_WARNING = "Hydration failed because the server rendered HTML didn't match";

const renderServerMarkup = () => {
  const browserWindow = window;
  vi.stubGlobal('window', undefined);
  const html = renderToString(<DebugLogIntegration />);
  vi.stubGlobal('window', browserWindow);
  return html;
};

describe('DebugLogIntegration hydration', () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    window.__MOKE_EMBEDDED = false;
    window.__MOKE_DEBUG_PANEL = false;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    container.remove();
    delete window.__MOKE_EMBEDDED;
    delete window.__MOKE_DEBUG_PANEL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the first client tree equal to SSR, then mounts a usable debug panel', async () => {
    container.innerHTML = renderServerMarkup();
    expect(container.innerHTML).toBe('');

    window.__MOKE_EMBEDDED = true;
    window.__MOKE_DEBUG_PANEL = true;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const recoverableErrors: string[] = [];

    await act(async () => {
      root = hydrateRoot(container, <DebugLogIntegration />, {
        onRecoverableError: (error) => recoverableErrors.push(String(error)),
      });
      await Promise.resolve();
    });

    const capturedConsoleErrors = consoleError.mock.calls.flat().map(String).join('\n');
    expect(recoverableErrors.join('\n')).not.toContain(HYDRATION_WARNING);
    expect(capturedConsoleErrors).not.toContain(HYDRATION_WARNING);
    expect(capturedConsoleErrors).not.toContain(SCRIPT_TAG_WARNING);

    const launcher = await screen.findByRole('button', { name: 'Debug logs' });
    fireEvent.click(launcher);
    expect(screen.getByRole('dialog', { name: 'Debug logs' })).not.toBeNull();
    expect(debugMocks.installDebugLogBridge).toHaveBeenCalledOnce();
    expect(debugMocks.installConsoleCapture).toHaveBeenCalledOnce();
    expect(debugMocks.installNetworkCapture).toHaveBeenCalledOnce();
  });

  it('keeps the release default path empty and capture-free after hydration', async () => {
    container.innerHTML = renderServerMarkup();
    const recoverableErrors: string[] = [];

    await act(async () => {
      root = hydrateRoot(container, <DebugLogIntegration />, {
        onRecoverableError: (error) => recoverableErrors.push(String(error)),
      });
      await Promise.resolve();
    });

    expect(recoverableErrors).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Debug logs' })).toBeNull();
    expect(debugMocks.installDebugLogBridge).not.toHaveBeenCalled();
    expect(debugMocks.installConsoleCapture).not.toHaveBeenCalled();
    expect(debugMocks.installNetworkCapture).not.toHaveBeenCalled();
  });
});
