import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { AttemptPage } from './pages/AttemptPage';
import { CliPage } from './pages/CliPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { NewAttemptPage } from './pages/NewAttemptPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ResultPage } from './pages/ResultPage';
import { SubnetPage } from './pages/SubnetPage';

const TITLES: [RegExp, string][] = [
  [/^\/connexion/, 'Connexion'],
  [/^\/examen\/nouveau/, 'Nouvelle session'],
  [/^\/tentatives\/[^/]+\/resultat/, 'Résultats'],
  [/^\/tentatives\//, 'Session en cours'],
  [/^\/historique/, 'Historique'],
  [/^\/labs\/subnetting/, 'Subnetting trainer'],
  [/^\/labs\/cli/, 'CLI Cisco IOS'],
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
        <Route path="labs/cli" element={<CliPage />} />
        <Route path="labs" element={<Navigate to="/labs/subnetting" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
