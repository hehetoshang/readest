import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hydrateDebugLogs,
  installConsoleCapture,
  installNetworkCapture,
  uninstallConsoleCapture,
  uninstallNetworkCapture,
  useDebugLogStore,
} from '@/services/debugLog';

describe('Readest debug logging', () => {
  beforeEach(() => {
    uninstallConsoleCapture();
    uninstallNetworkCapture();
    localStorage.clear();
    useDebugLogStore.setState({ logs: [] });
  });

  it('captures every console error instead of hiding framework diagnostics', () => {
    installConsoleCapture();

    const frameworkError =
      'Encountered a script tag while rendering React component. Scripts inside React components are never executed when rendering on the client. Consider using template tag instead (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).';
    console.error(frameworkError);
    console.error('reader crashed');

    expect(useDebugLogStore.getState().logs).toHaveLength(2);
    expect(useDebugLogStore.getState().logs.map((entry) => entry.message)).toEqual([
      frameworkError,
      'reader crashed',
    ]);
  });

  it('restores persisted framework diagnostics with other reader errors', () => {
    const base = {
      time: '11:51:58.776',
      createdAt: Date.now(),
      level: 'error',
      type: 'console',
      source: 'readest',
      tag: 'console',
    } as const;
    localStorage.setItem(
      'moke-debug-logs-v1',
      JSON.stringify([
        {
          ...base,
          id: 'old-framework-warning',
          message:
            'Encountered a script tag while rendering React component. Scripts inside React components are never executed when rendering on the client. Consider using template tag instead (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).',
        },
        { ...base, id: 'real-reader-error', message: 'book failed to open' },
      ]),
    );

    hydrateDebugLogs();

    expect(useDebugLogStore.getState().logs).toHaveLength(2);
    expect(useDebugLogStore.getState().logs.map((entry) => entry.message)).toEqual([
      'Encountered a script tag while rendering React component. Scripts inside React components are never executed when rendering on the client. Consider using template tag instead (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).',
      'book failed to open',
    ]);
  });

  it('retains framework diagnostics while merging synchronized state', () => {
    const createdAt = Date.now();
    useDebugLogStore.setState({
      logs: [
        {
          id: 'synced-framework-warning',
          time: '11:51:58.776',
          createdAt,
          level: 'error',
          type: 'console',
          source: 'readest',
          tag: 'console',
          message:
            'Encountered a script tag while rendering React component. Scripts inside React components are never executed when rendering on the client. Consider using template tag instead (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).',
        },
      ],
    });

    useDebugLogStore.getState().addLog('error', 'console', 'synchronized reader error');

    expect(useDebugLogStore.getState().logs).toHaveLength(2);
    expect(useDebugLogStore.getState().logs.map((entry) => entry.message)).toEqual([
      'Encountered a script tag while rendering React component. Scripts inside React components are never executed when rendering on the client. Consider using template tag instead (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).',
      'synchronized reader error',
    ]);
  });

  it('persists Readest entries so a document reload does not clear them', () => {
    useDebugLogStore.getState().addLog('warn', 'reader', 'render retry', { attempt: 2 });

    const stored = JSON.parse(localStorage.getItem('moke-debug-logs-v1') || '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      source: 'readest',
      level: 'warn',
      type: 'console',
      tag: 'reader',
      message: 'render retry',
    });
  });

  it('captures fetch success and keeps the original response', async () => {
    const original = window.fetch;
    const response = new Response('ok', { status: 200 });
    window.fetch = vi.fn(async () => response);
    installNetworkCapture();

    await expect(window.fetch('https://example.test/books?token=secret')).resolves.toBe(response);

    const logs = useDebugLogStore.getState().logs;
    expect(logs).toHaveLength(2);
    expect(logs.every((entry) => entry.type === 'network')).toBe(true);
    expect(logs[0]?.message).toContain('token=%3Credacted%3E');
    expect(logs[1]).toMatchObject({ level: 'success', source: 'readest' });

    uninstallNetworkCapture();
    window.fetch = original;
  });

  it('does not capture Tauri IPC transport requests', async () => {
    const original = window.fetch;
    const response = new Response(null, { status: 204 });
    const fetchMock = vi.fn(async () => response);
    window.fetch = fetchMock;
    installNetworkCapture();

    await window.fetch('http://ipc.localhost/plugin%3Aevent%7Cemit', { method: 'POST' });
    await window.fetch('ipc://localhost/plugin%3Aevent%7Cemit', { method: 'POST' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useDebugLogStore.getState().logs).toEqual([]);

    uninstallNetworkCapture();
    window.fetch = original;
  });

  it('persists an explicit clear and accepts new logs afterwards', () => {
    useDebugLogStore.getState().addLog('info', 'reader', 'before clear');
    useDebugLogStore.getState().clear();
    useDebugLogStore.getState().addLog('info', 'reader', 'after clear');

    const stored = JSON.parse(localStorage.getItem('moke-debug-logs-v1') || '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.message).toBe('after clear');
    expect(Number(localStorage.getItem('moke-debug-logs-cleared-at-v1'))).toBeGreaterThan(0);
  });
});
