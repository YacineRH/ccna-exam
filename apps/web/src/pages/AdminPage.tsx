import { useAuth } from '../auth/AuthContext';
import { MODULE_LABELS } from '../certification/ModuleGate';
import { EmptyState, ErrorBox, Led, PageTitle, Spinner } from '../components/ui';
import { formatDateTime, formatNumber } from '../lib/format';
import type { AdminCertification } from '../lib/types';
import { useApi } from '../lib/useApi';

/** Écran d'administration, en lecture seule : certifications, banque, série, dernier import. */
export function AdminPage() {
  const { user } = useAuth();
  if (user?.role !== 'admin') {
    return (
      <>
        <PageTitle eyebrow="ADMINISTRATION" title="Certifications" />
        <EmptyState title="Accès réservé aux administrateurs." />
      </>
    );
  }
  return <AdminCertifications />;
}

function seriesState(c: AdminCertification): { label: string; color: string } {
  if (c.series.exams === 0) return { label: 'aucune série figée', color: '#4A5B78' };
  const frozen = c.lastImport?.examsFrozen?.length ?? 0;
  if (frozen > 0) return { label: `${frozen} examen${frozen > 1 ? 's' : ''} déjà passé${frozen > 1 ? 's' : ''} gardé${frozen > 1 ? 's' : ''} tel${frozen > 1 ? 's' : ''} quel${frozen > 1 ? 's' : ''}`, color: '#F5B544' };
  return { label: 'à jour', color: '#3DDC97' };
}

function AdminCertifications() {
  const { data, error, loading, reload } = useApi<{ certifications: AdminCertification[] }>('/admin/certifications');
  return (
    <>
      <PageTitle eyebrow={<><span className="text-accent">●</span> ADMINISTRATION · LECTURE SEULE</>} title="Certifications" />
      {loading && !data && <Spinner label="Chargement des certifications…" />}
      {error != null && <ErrorBox error={error} onRetry={reload} title="Administration indisponible" />}
      {data && data.certifications.length === 0 && <EmptyState title="Aucune certification déclarée." />}
      {data && data.certifications.length > 0 && (
        <section aria-labelledby="admin-certs-h" className="panel px-4 py-5 sm:px-6">
          <h2 id="admin-certs-h" className="mb-3 text-base font-semibold">
            {data.certifications.length} certification{data.certifications.length > 1 ? 's' : ''}
          </h2>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tableau des certifications">
            <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="font-mono text-[11px] text-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">Certification</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Format</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Modules</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Banque</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Labs</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Série</th>
                  <th scope="col" className="py-2 font-medium">Dernier import</th>
                </tr>
              </thead>
              <tbody>
                {data.certifications.map((c) => {
                  const state = seriesState(c);
                  return (
                    <tr key={c.code} className="border-t border-raised align-top">
                      <th scope="row" className="py-2.5 pr-4 font-normal">
                        <span className="block font-medium text-text">{c.name}</span>
                        <span className="font-mono text-[12px] text-muted">
                          {c.code} · {c.examCode}
                          {!c.active && ' · inactive'}
                        </span>
                      </th>
                      <td className="py-2.5 pr-4 font-mono text-[12px] text-text2">
                        {c.examFormat.questionCount} q · {c.examFormat.durationMinutes} min
                        <br />
                        seuil {c.scoring.passing} ({c.scoring.min}–{c.scoring.max})
                        <br />
                        {c.domains} domaines · {c.subtopics} sous-thèmes
                      </td>
                      <td className="py-2.5 pr-4">
                        <ul className="flex flex-col gap-0.5 text-[12px] text-text2">
                          {c.modules.map((m) => (
                            <li key={m}>{MODULE_LABELS[m]}</li>
                          ))}
                        </ul>
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-[12px] text-text2">
                        <span className="text-text">{formatNumber(c.bank.published)}</span> publiées
                        <br />
                        {c.bank.validated} validées · {c.bank.draft} brouillons
                        {c.bank.retired > 0 && ` · ${c.bank.retired} retirées`}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-[12px] text-text2">
                        {c.labs.lab} labs
                        <br />
                        {c.labs.challenge} challenges
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-[12px] text-text2">
                        {c.series.exams} examens figés · {c.series.taken} passés
                        <br />
                        <span className="inline-flex items-center gap-1.5">
                          <Led color={state.color} /> {state.label}
                        </span>
                      </td>
                      <td className="py-2.5 font-mono text-[12px] text-text2">
                        {c.lastImportedAt ? formatDateTime(c.lastImportedAt) : 'jamais (déclarée par l’API)'}
                        {c.lastImport && (
                          <>
                            <br />
                            {c.lastImport.created ?? 0} nouvelles · {c.lastImport.updated ?? 0} mises à jour
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
