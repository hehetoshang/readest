'use client';

// Auth has been removed. This stub always returns unauthenticated state.
// TODO: Replace with talebook server authentication when ready.

import { createContext, useContext, useCallback, useMemo, ReactNode } from 'react';

interface AuthContextType {
  token: string | null;
  user: null;
  login: (token: string, user: unknown) => void;
  logout: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const login = useCallback((_token: string, _user: unknown) => {
    // TODO: Connect to talebook server authentication
  }, []);

  const logout = useCallback(async () => {
    // TODO: Connect to talebook server authentication
  }, []);

  const refresh = useCallback(async () => {
    // TODO: Connect to talebook server authentication
  }, []);

  const value = useMemo(
    () => ({ token: null, user: null, login, logout, refresh }),
    [login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
