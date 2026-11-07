import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export interface ApiState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** Charge une ressource GET ; `path = null` désactive la requête. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(path !== null);
  const [nonce, setNonce] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    if (path === null) return;
    const id = ++current.current;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api<T>(path, { signal: ctrl.signal })
      .then((d) => {
        if (id === current.current) setData(d);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === 'AbortError') return;
        if (id === current.current) setError(e);
      })
      .finally(() => {
        if (id === current.current) setLoading(false);
      });
    return () => ctrl.abort();
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
