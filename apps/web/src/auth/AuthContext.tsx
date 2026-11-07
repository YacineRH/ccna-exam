import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, setUnauthorizedHandler } from '../lib/api';
import type { User } from '../lib/types';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthValue {
  status: AuthStatus;
  user: User | null;
  /** Erreur réseau au chargement de la session (API arrêtée…), distincte d'un 401. */
  bootError: unknown;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [bootError, setBootError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setBootError(null);
    api<{ user: User }>('/auth/me')
      .then(({ user: u }) => {
        if (cancelled) return;
        setUser(u);
        setStatus('authenticated');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setUser(null);
        if (!(err instanceof ApiError && err.status === 401)) setBootError(err);
        setStatus('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus('anonymous');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user: u } = await api<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } });
    setUser(u);
    setBootError(null);
    setStatus('authenticated');
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    const { user: u } = await api<{ user: User }>('/auth/register', {
      method: 'POST',
      body: { email, password, displayName },
    });
    setUser(u);
    setBootError(null);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo(
    () => ({ status, user, bootError, login, register, logout, retry }),
    [status, user, bootError, login, register, logout, retry],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth hors de AuthProvider');
  return ctx;
}
