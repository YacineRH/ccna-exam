import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { MODULE_LABELS } from '../certification/ModuleGate';
import { EmptyState, ErrorBox, Led, PageTitle, Spinner } from '../components/ui';
import { formatDateTime, formatNumber } from '../lib/format';
import { api, errorMessage } from '../lib/api';
import type { AdminCertification, AdminUser, CreatedUser } from '../lib/types';
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
  return (
    <>
      <AdminCertifications />
      <AdminAccounts />
    </>
  );
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
      <PageTitle eyebrow={<><span className="text-accent">●</span> ADMINISTRATION</>} title="Certifications" />
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

function AdminAccounts() {
  const { data, error, loading, reload } = useApi<{ users: AdminUser[] }>('/admin/users');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedUser | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    setCreated(null);
    setCopied(false);
    try {
      const body: Record<string, string> = { email, displayName };
      if (password) body.password = password;
      const res = await api<CreatedUser>('/admin/users', { method: 'POST', body });
      setCreated(res);
      setEmail('');
      setDisplayName('');
      setPassword('');
      reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby="admin-users-h" className="panel mt-6 px-4 py-5 sm:px-6">
      <h2 id="admin-users-h" className="mb-1 text-base font-semibold">Comptes</h2>
      <p className="mb-4 text-[13px] text-text2">
        Les inscriptions publiques restent fermées : créez ici un compte invité pour qu’un proche puisse essayer la plateforme.
      </p>

      <form onSubmit={(e) => void submit(e)} className="mb-5 grid gap-3 sm:grid-cols-3" aria-label="Créer un compte invité">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="guest-name" className="text-[13px] text-text2">Nom affiché</label>
          <span className="field">
            <input id="guest-name" className="input-bare" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={64} autoComplete="off" />
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="guest-email" className="text-[13px] text-text2">E-mail</label>
          <span className="field">
            <input id="guest-email" type="email" className="input-bare font-mono" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="off" />
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="guest-password" className="text-[13px] text-text2">Mot de passe (facultatif, 12 car. min.)</label>
          <span className="field">
            <input id="guest-password" className="input-bare font-mono" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} placeholder="généré si vide" autoComplete="off" />
          </span>
        </div>
        <div className="sm:col-span-3">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Création…' : 'Créer le compte invité'}
          </button>
        </div>
      </form>

      <div aria-live="polite">
        {formError && <p role="alert" className="mb-4 text-[13px] text-[#FF6B5E]">{formError}</p>}
        {created && (
          <div role="status" className="mb-5 rounded-lg border border-line2 bg-chrome px-4 py-3 text-[13px]">
            <p className="font-medium text-text">Compte créé pour {created.user.displayName} ({created.user.email}).</p>
            {created.password ? (
              <>
                <p className="mt-2 text-text2">Mot de passe généré — il ne sera plus affiché, transmettez-le maintenant :</p>
                <p className="mt-1 flex flex-wrap items-center gap-3">
                  <code className="font-mono text-accent">{created.password}</code>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => void copy(created.password as string)}>
                    {copied ? 'Copié' : 'Copier'}
                  </button>
                </p>
              </>
            ) : (
              <p className="mt-2 text-text2">Le mot de passe est celui que vous avez saisi.</p>
            )}
          </div>
        )}
      </div>

      {loading && !data && <Spinner label="Chargement des comptes…" />}
      {error != null && <ErrorBox error={error} onRetry={reload} title="Liste des comptes indisponible" />}
      {data && (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tableau des comptes">
          <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="font-mono text-[11px] text-muted">
                <th scope="col" className="py-2 pr-4 font-medium">Nom</th>
                <th scope="col" className="py-2 pr-4 font-medium">E-mail</th>
                <th scope="col" className="py-2 pr-4 font-medium">Rôle</th>
                <th scope="col" className="py-2 pr-4 font-medium">Créé le</th>
                <th scope="col" className="py-2 pr-4 font-medium">Sessions</th>
                <th scope="col" className="py-2 font-medium">Dernière activité</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} className="border-t border-raised">
                  <th scope="row" className="py-2.5 pr-4 font-medium text-text">{u.displayName}</th>
                  <td className="py-2.5 pr-4 font-mono text-[12px] text-text2">{u.email}</td>
                  <td className="py-2.5 pr-4 text-text2">{u.role === 'admin' ? 'administrateur' : 'invité'}</td>
                  <td className="py-2.5 pr-4 font-mono text-[12px] text-text2">{formatDateTime(u.createdAt)}</td>
                  <td className="py-2.5 pr-4 font-mono text-[12px] text-text2">{formatNumber(u.attempts)}</td>
                  <td className="py-2.5 font-mono text-[12px] text-text2">{u.lastActiveAt ? formatDateTime(u.lastActiveAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
