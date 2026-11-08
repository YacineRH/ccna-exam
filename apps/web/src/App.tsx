import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { ModuleGate } from './certification/ModuleGate';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';

/*
 * Découpage du bundle par route : seuls la connexion et la coque (en-tête, menu) sont dans le paquet
 * initial. Chaque écran, et les graphiques qu'il utilise, se charge à la demande.
 */
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}
const DashboardPage = page(() => import('./pages/DashboardPage'), 'DashboardPage');
const NewAttemptPage = page(() => import('./pages/NewAttemptPage'), 'NewAttemptPage');
const AttemptPage = page(() => import('./pages/AttemptPage'), 'AttemptPage');
const ResultPage = page(() => import('./pages/ResultPage'), 'ResultPage');
const HistoryPage = page(() => import('./pages/HistoryPage'), 'HistoryPage');
const SubnetPage = page(() => import('./pages/SubnetPage'), 'SubnetPage');
const LabsPage = page(() => import('./pages/LabsPage'), 'LabsPage');
const LabIntroPage = page(() => import('./pages/LabPage'), 'LabIntroPage');
const LabSessionPage = page(() => import('./pages/LabPage'), 'LabSessionPage');
const ChallengesPage = page(() => import('./pages/ChallengesPage'), 'ChallengesPage');
const RevisionPage = page(() => import('./pages/RevisionPage'), 'RevisionPage');
const RevisionSessionPage = page(() => import('./pages/RevisionPage'), 'RevisionSessionPage');
const AdminPage = page(() => import('./pages/AdminPage'), 'AdminPage');
const NotFoundPage = page(() => import('./pages/NotFoundPage'), 'NotFoundPage');

const Loading = ({ children }: { children: ReactNode }) => <Suspense fallback={<Spinner label="Chargement de la page…" />}>{children}</Suspense>;

const TITLES: [RegExp, string][] = [
  [/^\/connexion/, 'Connexion'],
  [/^\/examen\/nouveau/, 'Nouvelle session'],
  [/^\/tentatives\/[^/]+\/resultat/, 'Résultats'],
  [/^\/tentatives\//, 'Session en cours'],
  [/^\/historique/, 'Historique'],
  [/^\/labs\/subnetting/, 'Subnetting trainer'],
  [/^\/labs\/cli\/sessions\//, 'Session de lab CLI'],
  [/^\/labs\/cli\/.+/, 'Lab CLI'],
  [/^\/labs\/cli/, 'Labs CLI'],
  [/^\/challenges\/sessions\//, 'Challenge en cours'],
  [/^\/challenges\/.+/, 'Challenge'],
  [/^\/challenges/, 'Challenges'],
  [/^\/revision\/sessions\//, 'Session de révision'],
  [/^\/revision/, 'Révision espacée'],
  [/^\/admin/, 'Administration'],
  [/^\/$/, 'Tableau de bord'],
];

function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const t = TITLES.find(([re]) => re.test(pathname))?.[1];
    document.title = t ? `${t} · ExamForge` : 'ExamForge';
  }, [pathname]);
}

export function App() {
  useDocumentTitle();
  return (
    <Routes>
      <Route path="/connexion" element={<LoginPage />} />
      <Route
        path="/tentatives/:id"
        element={
          <RequireAuth>
            <Loading>
              <AttemptPage />
            </Loading>
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="examen/nouveau" element={<NewAttemptPage />} />
        <Route path="tentatives/:id/resultat" element={<ResultPage />} />
        <Route path="historique" element={<HistoryPage />} />
        <Route path="labs/subnetting" element={<ModuleGate module="subnet"><SubnetPage /></ModuleGate>} />
        <Route path="labs/cli" element={<ModuleGate module="cli"><LabsPage /></ModuleGate>} />
        <Route path="labs/cli/sessions/:id" element={<ModuleGate module="cli"><LabSessionPage /></ModuleGate>} />
        <Route path="labs/cli/:slug" element={<ModuleGate module="cli"><LabIntroPage /></ModuleGate>} />
        <Route path="labs" element={<Navigate to="/labs/subnetting" replace />} />
        <Route path="challenges" element={<ModuleGate module="challenges"><ChallengesPage /></ModuleGate>} />
        <Route path="challenges/sessions/:id" element={<ModuleGate module="challenges"><LabSessionPage /></ModuleGate>} />
        <Route path="challenges/:slug" element={<ModuleGate module="challenges"><LabIntroPage /></ModuleGate>} />
        <Route path="revision" element={<ModuleGate module="flashcards"><RevisionPage /></ModuleGate>} />
        <Route path="revision/sessions/:id" element={<ModuleGate module="flashcards"><RevisionSessionPage /></ModuleGate>} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
