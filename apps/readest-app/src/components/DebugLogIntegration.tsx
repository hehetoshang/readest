'use client';

import { useEffect, useState } from 'react';
import DebugLogPanel from '@/components/DebugLogPanel';
import {
  installConsoleCapture,
  installDebugLogBridge,
  installNetworkCapture,
  uninstallConsoleCapture,
  uninstallNetworkCapture,
} from '@/services/debugLog';

// The launch globals are injected before the Next bundle. Start capturing as
// soon as this module loads so failures during Providers/appService bootstrap
// are not lost before the panel component mounts.
if (typeof window !== 'undefined' && window.__MOKE_EMBEDDED && window.__MOKE_DEBUG_PANEL) {
  installConsoleCapture();
  installNetworkCapture();
}

function initialPanelVisibility(): boolean {
  if (typeof window === 'undefined' || !window.__MOKE_EMBEDDED) return false;
  if (typeof window.__MOKE_DEBUG_PANEL === 'boolean') return window.__MOKE_DEBUG_PANEL;
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem('moke-developer-storage') || '{}',
    );
    const state = value && typeof value === 'object' ? (value as { state?: unknown }).state : null;
    return !!(
      state &&
      typeof state === 'object' &&
      (state as { showDebugPanel?: unknown }).showDebugPanel
    );
  } catch {
    return false;
  }
}

export default function DebugLogIntegration() {
  const [visible, setVisible] = useState(initialPanelVisibility);
  const embedded = typeof window !== 'undefined' && !!window.__MOKE_EMBEDDED;

  useEffect(() => {
    if (!embedded) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void installDebugLogBridge(setVisible).then((uninstall) => {
      if (disposed) uninstall();
      else cleanup = uninstall;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [embedded]);

  useEffect(() => {
    if (!embedded || !visible) {
      uninstallConsoleCapture();
      uninstallNetworkCapture();
      return;
    }
    installConsoleCapture();
    installNetworkCapture();
    return () => {
      uninstallConsoleCapture();
      uninstallNetworkCapture();
    };
  }, [embedded, visible]);

  if (!embedded) return null;
  return <DebugLogPanel visible={visible} />;
}
