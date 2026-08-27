import type { JSX, ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { clearStoredAuth, getStoredAuth, setStoredAuth, type StoredAuth } from '@/shared/lib/auth-storage';

interface AuthContextValue {
  auth: StoredAuth | null;
  isAuthenticated: boolean;
  hasWorkspace: boolean;
  login: (auth: StoredAuth) => void;
  logout: () => void;
  setWorkspace: (workspaceId: string, accessToken: string) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [auth, setAuth] = useState<StoredAuth | null>(() => getStoredAuth());

  useEffect(() => {
    const handler = (): void => { setAuth(getStoredAuth()); };
    window.addEventListener('bizpilot-ai:auth-changed', handler);
    return () => { window.removeEventListener('bizpilot-ai:auth-changed', handler); };
  }, []);

  const value: AuthContextValue = {
    auth,
    isAuthenticated: auth !== null,
    hasWorkspace: auth?.workspaceId != null,
    login: (nextAuth) => { setStoredAuth(nextAuth); },
    logout: () => { clearStoredAuth(); },
    // Phase 18: reads fresh from storage rather than closing over the `auth`
    // state variable — a caller that invokes `login()` and `setWorkspace()`
    // within the same handler (e.g. LoginPage resolving an existing
    // workspace right after signing in) would otherwise capture `auth` from
    // before the login call, see it as null, and silently no-op.
    setWorkspace: (workspaceId, accessToken) => {
      const current = getStoredAuth();
      if (!current) return;
      setStoredAuth({ ...current, workspaceId, accessToken });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
