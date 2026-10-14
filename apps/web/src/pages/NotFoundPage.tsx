import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-3 py-10">
      <div className="font-mono text-[12px] font-semibold tracking-[1.4px] text-crit">✕ 404 · ROUTE INTROUVABLE</div>
      <h1 className="text-[28px] font-semibold">Cette page n'existe pas.</h1>
      <p className="text-text2">Le lien est peut-être incomplet ou la page a été déplacée.</p>
      <Link to="/" className="btn-primary">
        Retour au tableau de bord
      </Link>
    </div>
  );
}
