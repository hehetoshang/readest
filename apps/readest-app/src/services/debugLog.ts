import { create } from 'zustand';

export type DebugLogLevel = 'info' | 'success' | 'warn' | 'error';
export type DebugLogType = 'console' | 'network';
export type DebugLogSource = 'moke' | 'readest';

export interface DebugLogEntry {
  id: string;
  time: string;
  createdAt: number;
  level: DebugLogLevel;
  type: DebugLogType;
  source: DebugLogSource;
  tag: string;
  message: string;
  detail?: string;
}

interface DebugLogState {
  logs: DebugLogEntry[];
  addLog: (
    level: DebugLogLevel,
    tag: string,
    message: string,
    detail?: unknown,
    type?: DebugLogType,
  ) => void;
  clear: () => void;
}

type DebugLogSyncMessage =
  | { kind: 'append'; sender: string; entry: DebugLogEntry }
  | { kind: 'clear'; sender: string; clearedAt: number }
  | { kind: 'request'; sender: string }
  | { kind: 'snapshot'; sender: string; target: string; logs: DebugLogEntry[] }
  | { kind: 'visibility-request'; sender: string }
  | { kind: 'visibility'; sender: string; visible: boolean };

const STORAGE_KEY = 'moke-debug-logs-v1';
const CLEAR_STORAGE_KEY = 'moke-debug-logs-cleared-at-v1';
const DEBUG_LOG_SYNC_EVENT = 'moke:debug-log-sync:v1';
const MAX_LOGS_PER_TYPE = 1000;
const MAX_PERSISTED_LOGS_PER_TYPE = 500;
const MAX_PERSISTED_DETAIL_LENGTH = 20_000;
const instanceId = createInstanceId();
let counter = 0;
let hydrated = false;
let bridgeSender: ((message: DebugLogSyncMessage) => void) | null = null;
let lastClearedAt = 0;

function createInstanceId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // This id only de-duplicates cross-window messages.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function stringifyDetail(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined;
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

function isDebugLogEntry(value: unknown): value is DebugLogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<DebugLogEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.time === 'string' &&
    typeof entry.createdAt === 'number' &&
    ['info', 'success', 'warn', 'error'].includes(String(entry.level)) &&
    ['console', 'network'].includes(String(entry.type)) &&
    ['moke', 'readest'].includes(String(entry.source)) &&
    typeof entry.tag === 'string' &&
    typeof entry.message === 'string'
  );
}

function limitLogs(logs: DebugLogEntry[], perTypeLimit: number): DebugLogEntry[] {
  const newestFirst = [...logs].sort((a, b) => b.createdAt - a.createdAt);
  const counts: Record<DebugLogType, number> = { console: 0, network: 0 };
  return newestFirst
    .filter((entry) => {
      if (counts[entry.type] >= perTypeLimit) return false;
      counts[entry.type] += 1;
      return true;
    })
    .sort((a, b) => a.createdAt - b.createdAt);
}

function mergeLogs(current: DebugLogEntry[], incoming: DebugLogEntry[]): DebugLogEntry[] {
  const byId = new Map(
    current
      .filter((entry) => isDebugLogEntry(entry) && entry.createdAt > lastClearedAt)
      .map((entry) => [entry.id, entry]),
  );
  for (const entry of incoming) {
    if (isDebugLogEntry(entry) && entry.createdAt > lastClearedAt) {
      byId.set(entry.id, entry);
    }
  }
  return limitLogs([...byId.values()], MAX_LOGS_PER_TYPE);
}

function readPersistedClearTime(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const value = Number(window.localStorage.getItem(CLEAR_STORAGE_KEY) || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function readPersistedLogs(): DebugLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed)
      ? limitLogs(parsed.filter(isDebugLogEntry), MAX_PERSISTED_LOGS_PER_TYPE)
      : [];
  } catch {
    return [];
  }
}

function persistLogs(logs: DebugLogEntry[], mergeExisting = true): void {
  if (typeof window === 'undefined') return;
  try {
    const combined = mergeExisting ? mergeLogs(readPersistedLogs(), logs) : logs;
    const persisted = limitLogs(combined, MAX_PERSISTED_LOGS_PER_TYPE).map((entry) => ({
      ...entry,
      detail: entry.detail?.slice(0, MAX_PERSISTED_DETAIL_LENGTH),
    }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Best effort on restricted WebView/custom-scheme storage.
  }
}

function addSyncedLogs(logs: DebugLogEntry[]): void {
  if (logs.length === 0) return;
  useDebugLogStore.setState((state) => {
    const merged = mergeLogs(state.logs, logs);
    persistLogs(merged);
    return { logs: merged };
  });
}

function clearSyncedLogs(clearedAt = Date.now()): void {
  lastClearedAt = Math.max(lastClearedAt, clearedAt);
  useDebugLogStore.setState({ logs: [] });
  try {
    window.localStorage.setItem(CLEAR_STORAGE_KEY, String(lastClearedAt));
  } catch {
    // Best effort, matching the log history persistence path.
  }
  persistLogs([], false);
}

function createEntry(
  level: DebugLogLevel,
  tag: string,
  message: string,
  detail?: unknown,
  type: DebugLogType = 'console',
): DebugLogEntry {
  const createdAt = Math.max(Date.now(), lastClearedAt + 1);
  return {
    id: `readest:${instanceId}:${++counter}`,
    time:
      new Date(createdAt).toLocaleTimeString('zh-CN', { hour12: false }) +
      '.' +
      String(createdAt % 1000).padStart(3, '0'),
    createdAt,
    level,
    type,
    source: 'readest',
    tag,
    message,
    detail: stringifyDetail(detail),
  };
}

export const useDebugLogStore = create<DebugLogState>((set) => ({
  logs: [],
  addLog: (level, tag, message, detail, type) => {
    const entry = createEntry(level, tag, message, detail, type);
    set((state) => {
      const logs = mergeLogs(state.logs, [entry]);
      persistLogs(logs);
      return { logs };
    });
    bridgeSender?.({ kind: 'append', sender: instanceId, entry });
  },
  clear: () => {
    const clearedAt = Date.now();
    lastClearedAt = Math.max(lastClearedAt, clearedAt);
    set({ logs: [] });
    try {
      if (typeof window === 'undefined') throw new Error('no window');
      window.localStorage.setItem(CLEAR_STORAGE_KEY, String(lastClearedAt));
    } catch {
      // Best effort, matching the log history persistence path.
    }
    persistLogs([], false);
    bridgeSender?.({ kind: 'clear', sender: instanceId, clearedAt });
  },
}));

export function hydrateDebugLogs(): void {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  lastClearedAt = readPersistedClearTime();
  addSyncedLogs(readPersistedLogs());
}

/**
 * Synchronize with the Moke host and other reader windows. Local storage keeps
 * the history across full-document navigation; Tauri events cover windows
 * whose WebView storage is isolated (including split dev-server origins).
 */
export async function installDebugLogBridge(
  onPanelVisible: (visible: boolean) => void,
): Promise<() => void> {
  if (typeof window === 'undefined') return () => {};
  hydrateDebugLogs();

  const handleStorage = (event: StorageEvent) => {
    if (event.key === CLEAR_STORAGE_KEY) {
      clearSyncedLogs(Number(event.newValue || 0));
      return;
    }
    if (event.key !== STORAGE_KEY) return;
    if (!event.newValue) {
      clearSyncedLogs();
      return;
    }
    try {
      const parsed: unknown = JSON.parse(event.newValue);
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) clearSyncedLogs(readPersistedClearTime());
        else addSyncedLogs(parsed.filter(isDebugLogEntry));
      }
    } catch {
      // Ignore incompatible storage payloads.
    }
  };
  window.addEventListener('storage', handleStorage);

  if (process.env['NEXT_PUBLIC_APP_PLATFORM'] !== 'tauri') {
    return () => window.removeEventListener('storage', handleStorage);
  }

  try {
    const [{ emit, listen }, { getCurrentWindow }] = await Promise.all([
      import('@tauri-apps/api/event'),
      import('@tauri-apps/api/window'),
    ]);
    const sender = `readest:${getCurrentWindow().label}:${instanceId}`;
    const send = (message: DebugLogSyncMessage) => {
      void emit(DEBUG_LOG_SYNC_EVENT, { ...message, sender }).catch(() => undefined);
    };
    bridgeSender = send;

    const unlisten = await listen<DebugLogSyncMessage>(DEBUG_LOG_SYNC_EVENT, ({ payload }) => {
      if (!payload || payload.sender === sender) return;
      switch (payload.kind) {
        case 'append':
          addSyncedLogs([payload.entry]);
          break;
        case 'clear':
          clearSyncedLogs(payload.clearedAt);
          break;
        case 'request':
          send({
            kind: 'snapshot',
            sender,
            target: payload.sender,
            logs: useDebugLogStore.getState().logs,
          });
          break;
        case 'snapshot':
          if (payload.target === sender) addSyncedLogs(payload.logs);
          break;
        case 'visibility':
          onPanelVisible(payload.visible);
          break;
        case 'visibility-request':
          break;
      }
    });

    send({ kind: 'request', sender });
    send({ kind: 'visibility-request', sender });

    return () => {
      unlisten();
      window.removeEventListener('storage', handleStorage);
      if (bridgeSender === send) bridgeSender = null;
    };
  } catch {
    return () => window.removeEventListener('storage', handleStorage);
  }
}

function formatConsoleArg(arg: unknown): string {
  if (arg instanceof Error) {
    return `${arg.name || 'Error'}: ${arg.message || ''}${arg.stack ? `\n${arg.stack}` : ''}`;
  }
  if (typeof arg === 'string') return arg;
  try {
    const value = JSON.stringify(arg, null, 2);
    return value === undefined ? String(arg) : value;
  } catch {
    return String(arg);
  }
}

function formatConsoleArgs(args: unknown[]): { message: string; detail?: string } {
  const lines: string[] = [];
  const details: string[] = [];
  for (const arg of args) {
    const text = formatConsoleArg(arg);
    const [first = '', ...rest] = text.split('\n');
    lines.push(first);
    if (rest.length) details.push(rest.join('\n'));
  }
  return { message: lines.join(' '), detail: details.length ? details.join('\n') : undefined };
}

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
let consoleCaptureInstalled = false;

export function installConsoleCapture(): void {
  if (consoleCaptureInstalled || typeof window === 'undefined') return;
  consoleCaptureInstalled = true;
  const capture = (level: DebugLogLevel, native: (...args: unknown[]) => void, args: unknown[]) => {
    native(...args);
    const { message, detail } = formatConsoleArgs(args);
    useDebugLogStore.getState().addLog(level, 'console', message, detail, 'console');
  };
  console.log = (...args) => capture('info', originalConsole.log, args);
  console.info = (...args) => capture('info', originalConsole.info, args);
  console.debug = (...args) => capture('info', originalConsole.debug, args);
  console.warn = (...args) => capture('warn', originalConsole.warn, args);
  console.error = (...args) => capture('error', originalConsole.error, args);
}

export function uninstallConsoleCapture(): void {
  if (!consoleCaptureInstalled || typeof window === 'undefined') return;
  consoleCaptureInstalled = false;
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.debug = originalConsole.debug;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}

let originalFetch: typeof window.fetch | null = null;

function sanitizedRequestUrl(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    const url = new URL(raw, window.location.href);
    for (const key of url.searchParams.keys()) {
      if (/token|password|secret|auth|code|key/i.test(key)) {
        url.searchParams.set(key, '<redacted>');
      }
    }
    return url.href;
  } catch {
    return raw;
  }
}

function isTauriIpcUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === 'ipc:' || parsed.hostname === 'ipc.localhost';
  } catch {
    return false;
  }
}

export function installNetworkCapture(): void {
  if (originalFetch || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (
      init?.method || (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const url = sanitizedRequestUrl(input);
    // Tauri implements invoke/event calls through an internal fetch transport.
    // Logging that transport emits another debug-sync event, recursively creating
    // IPC requests until the WebView runs out of memory.
    if (isTauriIpcUrl(url)) return originalFetch!(input, init);

    const startedAt = Date.now();
    useDebugLogStore
      .getState()
      .addLog('info', 'request', `→ ${method} ${url}`, undefined, 'network');
    try {
      const response = await originalFetch!(input, init);
      const level: DebugLogLevel = response.ok
        ? 'success'
        : response.status >= 500
          ? 'error'
          : 'warn';
      useDebugLogStore
        .getState()
        .addLog(
          level,
          'request',
          `← ${response.status} ${method} ${url} (${Date.now() - startedAt}ms)`,
          undefined,
          'network',
        );
      return response;
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      useDebugLogStore
        .getState()
        .addLog(
          aborted ? 'warn' : 'error',
          'request',
          `${aborted ? '⊘' : '✗'} ${method} ${url} (${Date.now() - startedAt}ms)`,
          error,
          'network',
        );
      throw error;
    }
  };
}

export function uninstallNetworkCapture(): void {
  if (!originalFetch || typeof window === 'undefined') return;
  window.fetch = originalFetch;
  originalFetch = null;
}
