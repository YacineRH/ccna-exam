import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { initials } from '../lib/format';
import {
  IconClose,
  IconDashboard,
  IconGrid,
  IconHistory,
  IconLogout,
  IconMenu,
  IconTerminal,
  IconTimer,
  IconTrend,
  LogoMark,
} from './Icons';
import { Led } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: ReactNode;
  /** Actif uniquement si la recherche correspond aussi (ex. ?mode=exam). */
  match?: (pathname: string, search: string) => boolean;
}

const PILOTAGE: NavItem[] = [
  { to: '/', label: 'Tableau de bord', icon: <IconDashboard />, match: (p) => p === '/' },
  {
    to: '/examen/nouveau?mode=exam',
    label: 'Examens blancs',
    icon: <IconTimer />,
    match: (p, s) => p === '/examen/nouveau' && !s.includes('mode=practice'),
  },
  {
    to: '/examen/nouveau?mode=practice',
    label: 'Entraînement libre',
    icon: <IconTrend />,
    match: (p, s) => p === '/examen/nouveau' && s.includes('mode=practice'),
  },
  { to: '/historique', label: 'Historique', icon: <IconHistory />, match: (p) => p === '/historique' || p.endsWith('/resultat') },
];

const LABS: NavItem[] = [
  { to: '/labs/subnetting', label: 'Subnetting', icon: <IconGrid /> },
  {
    to: '/labs/cli',
    label: 'CLI Cisco IOS',
    icon: <IconTerminal />,
    badge: <span className="ml-auto rounded border border-line2 px-1 py-px font-mono text-[9px] font-semibold text-muted">BIENTÔT</span>,
  },
];

function SideLink({ item }: { item: NavItem }) {
  const { pathname, search } = useLocation();
  const active = item.match ? item.match(pathname, search) : pathname.startsWith(item.to);
  return (
    <NavLink
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-[44px] items-center gap-2.5 rounded-lg px-3 ${
        active ? 'font-medium text-text' : 'text-text2 hover:bg-raised/60 hover:text-text'
      }`}
      style={
        active
          ? { background: 'linear-gradient(90deg, rgba(45,212,232,.14), rgba(45,212,232,0))', boxShadow: 'inset 2px 0 0 #2DD4E8' }
          : undefined
      }
    >
      <span className={active ? 'text-accent' : ''}>{item.icon}</span>
      <span className="whitespace-nowrap">{item.label}</span>
      {item.badge}
    </NavLink>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Compte de ${user.displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-line2 bg-raised font-display text-[13px] font-semibold text-text"
        style={{ boxShadow: '0 0 0 3px rgba(45,212,232,.12)' }}
      >
        {initials(user.displayName)}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[52px] z-30 w-64 rounded-xl border border-line bg-surface p-2 shadow-hero"
        >
          <div className="px-3 py-2">
            <div className="truncate font-medium">{user.displayName}</div>
            <div className="truncate font-mono text-[12px] text-muted">{user.email}</div>
            {user.role === 'admin' && <div className="mt-1 font-mono text-[11px] text-accent">ADMINISTRATEUR</div>}
          </div>
          <button
            type="button"
            role="menuitem"
            className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left text-text2 hover:bg-raised hover:text-text"
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate('/connexion', { replace: true });
            }}
          >
            <IconLogout /> Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname, location.search]);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#contenu"
        className="sr-only z-50 rounded bg-accent px-3 py-2 text-accent-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Aller au contenu
      </a>
      <header className="chrome sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-3 border-b border-line px-4 sm:gap-4 sm:px-6">
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-text lg:hidden"
          aria-label={navOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          aria-expanded={navOpen}
          aria-controls="menu-principal"
          onClick={() => setNavOpen((o) => !o)}
        >
          {navOpen ? <IconClose /> : <IconMenu />}
        </button>
        <Link to="/" className="flex items-center gap-3 text-text hover:text-text" aria-label="ExamForge, tableau de bord">
          <span
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border text-accent"
            style={{ background: '#0E2A33', borderColor: 'rgba(45,212,232,.5)', boxShadow: '0 0 18px -2px rgba(45,212,232,.45)' }}
          >
            <LogoMark />
          </span>
          <span className="font-display text-lg font-bold tracking-[-0.3px]">
            Exam<span className="text-accent">Forge</span>
          </span>
        </Link>
        <span
          className="hidden h-9 items-center gap-2 rounded-lg border border-line px-3 font-mono text-[13px] font-medium sm:flex"
          style={{ background: 'rgba(16,24,39,.8)' }}
          title="Certification active"
        >
          <Led />
          CCNA 200-301
        </span>
        <div className="flex-1" />
        <AccountMenu />
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <nav
          id="menu-principal"
          aria-label="Navigation principale"
          className={`${navOpen ? 'flex' : 'hidden'} flex-col gap-0.5 border-b border-line px-3.5 py-5 lg:sticky lg:top-16 lg:flex lg:h-[calc(100vh-4rem)] lg:w-[228px] lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r`}
          style={{ background: 'rgba(8,12,21,.6)' }}
        >
          <div className="label-mono px-3 py-2 text-[10.5px] tracking-[1.6px]">// Pilotage</div>
          {PILOTAGE.map((i) => (
            <SideLink key={i.to} item={i} />
          ))}
          <div className="label-mono px-3 pb-2 pt-5 text-[10.5px] tracking-[1.6px]">// Labs</div>
          {LABS.map((i) => (
            <SideLink key={i.to} item={i} />
          ))}
        </nav>
        <main id="contenu" tabIndex={-1} className="flex min-w-0 flex-1 flex-col gap-[22px] px-4 pb-14 pt-6 sm:px-8 sm:pt-[30px]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
