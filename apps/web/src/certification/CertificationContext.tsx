import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ErrorBox, EmptyState, Spinner } from '../components/ui';
import { pickCertification, readStoredCertification, storeCertification } from '../lib/certification';
import type { CertificationSummary } from '../lib/types';
import { useApi } from '../lib/useApi';

interface CertificationValue {
  /** Certifications actives, dans l'ordre de l'API. */
  certifications: CertificationSummary[];
  /** Certification choisie dans l'en-tête (null tant que la liste n'est pas chargée). */
  current: CertificationSummary | null;
  select: (code: string) => void;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

const CertificationContext = createContext<CertificationValue | null>(null);

/** Liste des certifications (route publique) et choix de l'utilisateur, mémorisé dans localStorage. */
export function CertificationProvider({ children }: { children: ReactNode }) {
  const { data, error, loading, reload } = useApi<{ certifications: CertificationSummary[] }>('/certifications');
  const [chosen, setChosen] = useState<string | null>(() => readStoredCertification());

  const certifications = useMemo(() => data?.certifications ?? [], [data]);
  const code = pickCertification(certifications, chosen);
  const current = certifications.find((c) => c.code === code) ?? null;

  const select = useCallback((next: string) => {
    setChosen(next);
    storeCertification(next);
  }, []);

  const value = useMemo(
    () => ({ certifications, current, select, loading, error, reload }),
    [certifications, current, select, loading, error, reload],
  );
  return <CertificationContext.Provider value={value}>{children}</CertificationContext.Provider>;
}

export function useCertification(): CertificationValue {
  const ctx = useContext(CertificationContext);
  if (!ctx) throw new Error('useCertification hors de CertificationProvider');
  return ctx;
}

/** Affiche le contenu pour la certification choisie, ou l'état de chargement / d'erreur de la liste. */
export function WithCertification({ children }: { children: (cert: CertificationSummary) => ReactNode }) {
  const { current, loading, error, reload } = useCertification();
  if (current) return <>{children(current)}</>;
  if (loading) return <Spinner label="Chargement des certifications…" />;
  if (error != null) return <ErrorBox error={error} onRetry={reload} title="Certifications indisponibles" />;
  return <EmptyState title="Aucune certification active.">Un administrateur doit d'abord en déclarer une.</EmptyState>;
}
