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
import { readPersistedMokeDebugPanel } from '@/helpers/mokeLaunchContext';

// The launch globals are injected before the Next bundle. Start capturing as
// soon as this module loads so failures during Providers/appService bootstrap
// are not lost before the panel component mounts.
if (typeof window !== 'undefined' && window.__MOKE_EMBEDDED && window.__MOKE_DEBUG_PANEL) {
  installConsoleCapture();
  installNetworkCapture();
}

function initialPanelVisibility(): boolean {
  if (typeof window === 'undefined' || !window.__MOKE_EMBEDDED) return false;
  // Never let a stale launch flag hide a switch that is durably enabled in
  // the shared mobile WebView storage. The URL remains authoritative for
  // enabling the panel in separate desktop reader windows.
  return window.__MOKE_DEBUG_PANEL === true || readPersistedMokeDebugPanel();
}

export default function DebugLogIntegration() {
  // The launch script and persisted storage only exist in the browser. Keep
  // both SSR and the first hydration render empty, then reveal the interactive
  // panel from an effect. Reading those values in a useState initializer made
  // the client start with a button where SSR emitted nothing, so React threw
  // away the server tree and rebuilt the whole root.
  const [mounted, setMounted] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const nextEmbedded = !!window.__MOKE_EMBEDDED;
    setEmbedded(nextEmbedded);
    setVisible(nextEmbedded && initialPanelVisibility());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !embedded) return;
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
  }, [mounted, embedded]);

  useEffect(() => {
    // Preserve module-time capture until the launch context has been read.
    // Otherwise this initial effect would uninstall it during hydration.
    if (!mounted) return;
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
  }, [mounted, embedded, visible]);

  if (!mounted || !embedded) return null;
  return <DebugLogPanel visible={visible} />;
}
