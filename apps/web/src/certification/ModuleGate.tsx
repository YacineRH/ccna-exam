import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, PageTitle } from '../components/ui';
import { certificationLabel, hasModule } from '../lib/certification';
import type { Module } from '../lib/types';
import { WithCertification } from './CertificationContext';

export const MODULE_LABELS: Record<Module, string> = {
  exam: 'Examens blancs',
  practice: 'Entraînement libre',
  flashcards: 'Révision espacée',
  subnet: 'Subnetting trainer',
  cli: 'Labs CLI',
  challenges: 'Challenges chronométrés',
};

/**
 * Affiche la page seulement si la certification choisie propose le module. Sinon (lien direct, ou
 * changement de certification dans l'en-tête), un écran explique que le module n'existe pas pour elle.
 */
export function ModuleGate({ module, children }: { module: Module; children: ReactNode }) {
  return (
    <WithCertification>
      {(cert) =>
        hasModule(cert, module) ? (
          <>{children}</>
        ) : (
          <>
            <PageTitle eyebrow={certificationLabel(cert)} title={MODULE_LABELS[module]} />
            <EmptyState
              title={`Module absent pour ${cert.shortName ?? cert.name}.`}
              action={
                <Link to="/" className="btn-secondary btn-sm">
                  Retour au tableau de bord
                </Link>
              }
            >
              La certification {cert.name} ne propose pas ce module. Changez de certification dans l'en-tête pour y accéder.
            </EmptyState>
          </>
        )
      }
    </WithCertification>
  );
}
