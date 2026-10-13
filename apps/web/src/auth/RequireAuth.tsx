import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '../components/ui';
import { useAuth } from './AuthContext';

/** Route protégée : sans session, redirection vers /connexion (puis retour à la page demandée). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="mx-auto max-w-5xl px-6">
        <Spinner label="Vérification de la session…" />
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/connexion" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}
