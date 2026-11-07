import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { LogoMark } from '../components/Icons';
import { ErrorBox, Led } from '../components/ui';
import { ApiError } from '../lib/api';

type Mode = 'login' | 'register';

function describe(err: unknown, mode: Mode): string | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 401) return 'E-mail ou mot de passe incorrect.';
  if (err.status === 403 && mode === 'register') return 'Les inscriptions sont fermées sur cette instance. Demandez un compte à l’administrateur.';
  if (err.code === 'email_taken') return 'Un compte existe déjà avec cet e-mail. Connectez-vous plutôt.';
  if (err.status === 429) return 'Trop de tentatives. Patientez une minute avant de réessayer.';
  if (err.status === 400 && Array.isArray(err.details)) {
    const msgs = (err.details as { path: string; message: string }[]).map((d) => {
      const field = d.path === 'email' ? 'E-mail' : d.path === 'password' ? 'Mot de passe' : d.path === 'displayName' ? 'Nom affiché' : d.path;
      return `${field} : ${d.message}`;
    });
    return msgs.join(' · ');
  }
  return null;
}

export function LoginPage() {
  const { status, login, register, bootError, retry } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to={from} replace />;

  const passwordTooShort = mode === 'register' && password.length > 0 && password.length < 12;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (mode === 'register' && password.length < 12) {
      setError(new ApiError(400, 'client', 'Le mot de passe doit contenir au moins 12 caractères.'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, displayName);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setError(null);
  };

  const friendly = describe(error, mode);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex items-center gap-3">
          <span
            className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border text-accent"
            style={{ background: '#0E2A33', borderColor: 'rgba(45,212,232,.5)', boxShadow: '0 0 18px -2px rgba(45,212,232,.45)' }}
          >
            <LogoMark />
          </span>
          <span className="font-display text-xl font-bold tracking-[-0.3px]">
            Exam<span className="text-accent">Forge</span>
          </span>
          <span className="ml-auto flex items-center gap-2 font-mono text-[12px] text-muted">
            <Led /> CCNA 200-301
          </span>
        </div>

        <section
          className="viewfinder relative rounded-2xl border border-line px-6 py-7 shadow-hero sm:px-8"
          style={{ background: 'radial-gradient(120% 140% at 0% 0%, rgba(45,212,232,0.10), rgba(16,24,39,0.9) 45%)' }}
          aria-labelledby="auth-h"
        >
          <div className="label-mono">{mode === 'login' ? 'Accès console' : 'Nouveau compte'}</div>
          <h1 id="auth-h" className="mt-1 text-[26px] font-semibold">
            {mode === 'login' ? 'Connexion' : 'Créer un compte'}
          </h1>
          <p className="mt-1 text-[13px] text-text2">
            {mode === 'login'
              ? 'Reprenez vos examens blancs là où vous les avez laissés.'
              : 'Le premier compte créé devient administrateur de l’instance.'}
          </p>

          {bootError != null && (
            <div className="mt-4">
              <ErrorBox error={bootError} onRetry={retry} title="API injoignable" />
            </div>
          )}

          <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
            {mode === 'register' && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="displayName" className="text-[13px] text-text2">
                  Nom affiché
                </label>
                <span className="field">
                  <input
                    id="displayName"
                    autoComplete="name"
                    required
                    maxLength={64}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="input-bare"
                  />
                </span>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-[13px] text-text2">
                E-mail
              </label>
              <span className="field">
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-bare font-mono"
                />
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-[13px] text-text2">
                Mot de passe
              </label>
              <span className="field" style={passwordTooShort ? { borderColor: '#F5B544' } : undefined}>
                <input
                  id="password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={mode === 'register' ? 12 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby={mode === 'register' ? 'pw-help' : undefined}
                  className="input-bare font-mono"
                />
              </span>
              {mode === 'register' && (
                <span id="pw-help" className={`font-mono text-[12px] ${passwordTooShort ? 'text-warn' : 'text-muted'}`}>
                  {passwordTooShort ? '▲ ' : ''}12 caractères minimum ({password.length}/12)
                </span>
              )}
            </div>

            {error != null && (
              <div role="alert" className="rounded-[10px] border px-4 py-3 text-[13.5px] text-text2" style={{ borderColor: 'rgba(255,107,94,.45)', background: 'rgba(255,107,94,.07)' }}>
                <span className="font-mono font-semibold text-crit">✕ </span>
                {friendly ?? (error instanceof Error ? error.message : 'Erreur inattendue')}
              </div>
            )}

            <button type="submit" className="btn-primary mt-1 w-full" disabled={submitting}>
              {submitting ? 'Connexion…' : mode === 'login' ? 'Se connecter' : 'Créer le compte'}
            </button>
          </form>

          <div className="mt-5 border-t border-line pt-4 text-center text-[13px] text-text2">
            {mode === 'login' ? 'Pas encore de compte ?' : 'Déjà un compte ?'}{' '}
            <button type="button" onClick={switchMode} className="min-h-[44px] px-1 font-medium text-accent hover:text-accent-soft">
              {mode === 'login' ? 'Créer un compte' : 'Se connecter'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
