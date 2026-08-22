'use client';

import { useState, type CSSProperties } from 'react';
import { writeTextToClipboard } from '@/utils/clipboard';
import { useDebugLogStore, type DebugLogLevel, type DebugLogType } from '@/services/debugLog';

const theme = {
  bg: 'oklch(var(--b1, 100% 0 0) / 1)',
  surface: 'oklch(var(--b2, 96% 0 0) / 1)',
  card: 'oklch(var(--b3, 90% 0 0) / 1)',
  border: 'oklch(var(--bc, 0% 0 0) / 0.18)',
  divider: 'oklch(var(--bc, 0% 0 0) / 0.1)',
  text: 'oklch(var(--bc, 0% 0 0) / 1)',
  muted: 'oklch(var(--bc, 0% 0 0) / 0.62)',
  primary: 'oklch(var(--p, 55% 0.16 250deg) / 1)',
  primaryContent: 'oklch(var(--pc, 100% 0 0) / 1)',
  destructive: 'oklch(var(--er, 62% 0.2 25deg) / 1)',
};

const levelColor: Record<DebugLogLevel, string> = {
  info: 'oklch(var(--in, 65% 0.12 235deg) / 1)',
  success: 'oklch(var(--su, 65% 0.14 155deg) / 1)',
  warn: 'oklch(var(--wa, 72% 0.15 75deg) / 1)',
  error: theme.destructive,
};

const levelLabel: Record<DebugLogLevel, string> = {
  info: 'INFO',
  success: 'OK',
  warn: 'WARN',
  error: 'ERR',
};

const LEVELS: DebugLogLevel[] = ['error', 'warn', 'success', 'info'];
const TABS: { value: DebugLogType; label: string }[] = [
  { value: 'console', label: 'Console' },
  { value: 'network', label: 'Network' },
];
type LevelFilterState = Record<DebugLogLevel, boolean>;
const defaultFilter: LevelFilterState = { error: true, warn: true, success: true, info: true };

export default function DebugLogPanel({ visible }: { visible: boolean }) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DebugLogType>('console');
  const [filters, setFilters] = useState<Record<DebugLogType, LevelFilterState>>({
    console: { ...defaultFilter },
    network: { ...defaultFilter },
  });
  const logs = useDebugLogStore((state) => state.logs);
  const clear = useDebugLogStore((state) => state.clear);
  const currentFilter = filters[activeTab];
  const visibleLogs = logs.filter(
    (entry) => entry.type === activeTab && currentFilter[entry.level],
  );
  const errorCount = logs.filter((entry) => entry.level === 'error').length;
  const tabCounts: Record<DebugLogType, number> = {
    console: logs.filter((entry) => entry.type === 'console').length,
    network: logs.filter((entry) => entry.type === 'network').length,
  };

  if (!visible) return null;

  const copyAll = async () => {
    const text = visibleLogs
      .map(
        (entry) =>
          `[${entry.time}] ${levelLabel[entry.level]} [${entry.source}] [${entry.tag}] ${entry.message}${entry.detail ? `\n${entry.detail}` : ''}`,
      )
      .join('\n');
    const copied = await writeTextToClipboard(text);
    if (!copied) window.prompt('Copy logs:', text);
  };

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen((value) => !value)}
        style={{
          position: 'fixed',
          right: 16,
          bottom: 'max(16px, env(safe-area-inset-bottom))',
          zIndex: 99999,
          width: 48,
          height: 48,
          borderRadius: 24,
          border: `1px solid ${errorCount > 0 ? theme.destructive : theme.primary}`,
          background: errorCount > 0 ? theme.destructive : theme.primary,
          color: theme.primaryContent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgb(0 0 0 / 0.2)',
        }}
        aria-label='Debug logs'
      >
        <img
          src='/debug.avif'
          alt='Debug logs'
          style={{ width: 20, height: 20, objectFit: 'contain' }}
        />
        {errorCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 18,
              height: 18,
              padding: '0 4px',
              borderRadius: 9,
              background: theme.bg,
              border: `1px solid ${theme.destructive}`,
              color: theme.destructive,
              fontSize: 11,
              fontWeight: 700,
              lineHeight: '16px',
              textAlign: 'center',
            }}
          >
            {errorCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99998,
            background: 'rgb(0 0 0 / 0.35)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
          onClick={() => setOpen(false)}
        >
          <div
            role='dialog'
            aria-label='Debug logs'
            onClick={(event) => event.stopPropagation()}
            style={{
              background: theme.bg,
              color: theme.text,
              maxHeight: '75vh',
              paddingBottom: 'env(safe-area-inset-bottom)',
              display: 'flex',
              flexDirection: 'column',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              boxShadow: '0 -8px 24px rgb(0 0 0 / 0.2)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 16px',
                background: theme.surface,
                borderBottom: `1px solid ${theme.border}`,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
              }}
            >
              <strong style={{ fontSize: 14 }}>Debug logs</strong>
              <span style={{ fontSize: 12, color: theme.muted }}>
                ({visibleLogs.length}/{logs.length})
              </span>
              <div style={{ flex: 1 }} />
              <button type='button' onClick={() => void copyAll()} style={buttonStyle}>
                Copy
              </button>
              <button type='button' onClick={clear} style={buttonStyle}>
                Clear
              </button>
              <button type='button' onClick={() => setOpen(false)} style={buttonStyle}>
                Close
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                padding: '10px 16px',
                borderBottom: `1px solid ${theme.border}`,
              }}
            >
              {TABS.map((tab) => {
                const active = tab.value === activeTab;
                return (
                  <button
                    type='button'
                    key={tab.value}
                    onClick={() => {
                      setActiveTab(tab.value);
                      setExpandedId(null);
                    }}
                    style={{
                      ...buttonStyle,
                      background: active ? theme.primary : theme.surface,
                      color: active ? theme.primaryContent : theme.text,
                      borderColor: active ? theme.primary : theme.border,
                      fontWeight: active ? 700 : 400,
                    }}
                  >
                    {tab.label} ({tabCounts[tab.value]})
                  </button>
                );
              })}
              <div style={{ display: 'flex', gap: 10, marginLeft: 'auto', flexWrap: 'wrap' }}>
                {LEVELS.map((level) => {
                  const checked = currentFilter[level];
                  return (
                    <label
                      key={level}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        color: checked ? levelColor[level] : theme.muted,
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      <input
                        type='checkbox'
                        checked={checked}
                        onChange={() =>
                          setFilters((previous) => ({
                            ...previous,
                            [activeTab]: {
                              ...previous[activeTab],
                              [level]: !previous[activeTab][level],
                            },
                          }))
                        }
                        style={{ accentColor: levelColor[level] }}
                      />
                      {levelLabel[level]}
                    </label>
                  );
                })}
              </div>
            </div>

            <div style={{ overflowY: 'auto', padding: '8px 12px', flex: 1 }}>
              {visibleLogs.length === 0 && (
                <div style={{ color: theme.muted, fontSize: 13, padding: 16, textAlign: 'center' }}>
                  {activeTab === 'network' ? 'No network requests yet' : 'No console logs yet'}
                </div>
              )}
              {visibleLogs.map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  style={{
                    padding: '6px 8px',
                    borderBottom: `1px solid ${theme.divider}`,
                    cursor: entry.detail ? 'pointer' : 'default',
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <span style={{ color: theme.muted, flexShrink: 0 }}>{entry.time}</span>
                    <span style={{ color: levelColor[entry.level], fontWeight: 700, minWidth: 36 }}>
                      {levelLabel[entry.level]}
                    </span>
                    <span
                      style={{
                        color: entry.source === 'moke' ? theme.primary : theme.muted,
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {entry.source}
                    </span>
                    <span style={{ color: theme.muted, flexShrink: 0, fontSize: 11 }}>
                      [{entry.tag}]
                    </span>
                    <span style={{ wordBreak: 'break-all' }}>{entry.message}</span>
                  </div>
                  {entry.detail && expandedId === entry.id && (
                    <pre
                      style={{
                        margin: '4px 0 0 42px',
                        padding: 8,
                        background: theme.surface,
                        border: `1px solid ${theme.border}`,
                        borderRadius: 8,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        fontSize: 11,
                        color: theme.text,
                      }}
                    >
                      {entry.detail}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const buttonStyle: CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  borderRadius: 8,
  border: `1px solid ${theme.border}`,
  background: theme.surface,
  color: theme.text,
  cursor: 'pointer',
};
