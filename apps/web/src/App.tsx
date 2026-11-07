import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { AttemptPage } from './pages/AttemptPage';
import { ChallengesPage } from './pages/ChallengesPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { LabIntroPage, LabSessionPage } from './pages/LabPage';
import { LabsPage } from './pages/LabsPage';
import { LoginPage } from './pages/LoginPage';
import { NewAttemptPage } from './pages/NewAttemptPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ResultPage } from './pages/ResultPage';
import { RevisionPage, RevisionSessionPage } from './pages/RevisionPage';
import { SubnetPage } from './pages/SubnetPage';

const TITLES: [RegExp, string][] = [
  [/^\/connexion/, 'Connexion'],
  [/^\/examen\/nouveau/, 'Nouvelle session'],
  [/^\/tentatives\/[^/]+\/resultat/, 'Résultats'],
  [/^\/tentatives\//, 'Session en cours'],
  [/^\/historique/, 'Historique'],
  [/^\/labs\/subnetting/, 'Subnetting trainer'],
  [/^\/labs\/cli\/sessions\//, 'Session de lab CLI'],
  [/^\/labs\/cli\/.+/, 'Lab CLI'],
  [/^\/labs\/cli/, 'CLI Cisco IOS'],
  [/^\/challenges\/sessions\//, 'Challenge en cours'],
  [/^\/challenges\/.+/, 'Challenge'],
  [/^\/challenges/, 'Challenges'],
  [/^\/revision\/sessions\//, 'Session de révision'],
  [/^\/revision/, 'Révision espacée'],
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
            <AttemptPage />
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
        <Route path="labs/subnetting" element={<SubnetPage />} />
        <Route path="labs/cli" element={<LabsPage />} />
        <Route path="labs/cli/sessions/:id" element={<LabSessionPage />} />
        <Route path="labs/cli/:slug" element={<LabIntroPage />} />
        <Route path="labs" element={<Navigate to="/labs/subnetting" replace />} />
        <Route path="challenges" element={<ChallengesPage />} />
        <Route path="challenges/sessions/:id" element={<LabSessionPage />} />
        <Route path="challenges/:slug" element={<LabIntroPage />} />
        <Route path="revision" element={<RevisionPage />} />
        <Route path="revision/sessions/:id" element={<RevisionSessionPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
