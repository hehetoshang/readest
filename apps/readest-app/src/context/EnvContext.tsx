'use client';

import React, { createContext, useCallback, useContext, useState, useMemo, ReactNode } from 'react';
import { EnvConfigType } from '../services/environment';
import { AppService } from '@/types/system';
import env from '../services/environment';

interface EnvContextType {
  envConfig: EnvConfigType;
  appService: AppService | null;
  appServiceError: string | null;
  retryAppService: () => void;
}

const EnvContext = createContext<EnvContextType | undefined>(undefined);

export const EnvProvider = ({ children }: { children: ReactNode }) => {
  const [envConfig] = useState<EnvConfigType>(env);
  const [appService, setAppService] = useState<AppService | null>(null);
  const [appServiceError, setAppServiceError] = useState<string | null>(null);

  const initializeAppService = useCallback(() => {
    setAppServiceError(null);
    envConfig
      .getAppService()
      .then((service) => {
        setAppService(service);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setAppServiceError(message);
        console.error('Failed to initialize app service:', err);
      });
  }, [envConfig]);

  React.useEffect(() => {
    // Moke does not provide a Readest cloud account. Keep the embedded reader
    // local-only and skip replica initialization, auto-sync, and cloud I/O.
    initializeAppService();
    const handleWindowError = (e: ErrorEvent) => {
      if (e.message === 'ResizeObserver loop limit exceeded') {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    };
    window.addEventListener('error', handleWindowError);
    return () => window.removeEventListener('error', handleWindowError);
  }, [initializeAppService]);

  const value = useMemo(
    () => ({
      envConfig,
      appService,
      appServiceError,
      retryAppService: initializeAppService,
    }),
    [envConfig, appService, appServiceError, initializeAppService],
  );
  return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>;
};

export const useEnv = (): EnvContextType => {
  const context = useContext(EnvContext);
  if (!context) throw new Error('useEnv must be used within EnvProvider');
  return context;
};
