import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installNetworkCapture,
  uninstallNetworkCapture,
  useDebugLogStore,
} from '@/services/debugLog';

describe('Readest debug logging', () => {
  beforeEach(() => {
    uninstallNetworkCapture();
    localStorage.clear();
    useDebugLogStore.setState({ logs: [] });
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
