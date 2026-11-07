import { Link } from 'react-router-dom';
import { IconTerminal } from '../components/Icons';

export function CliPage() {
  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-[22px]">
      <div>
        <div className="font-mono text-[12px] font-medium tracking-[0.6px] text-muted">
          <span className="text-accent">●</span> LABS · CISCO IOS
        </div>
        <h1 className="mt-1.5 text-[28px] font-semibold">CLI trainer</h1>
      </div>
      <section className="panel-deep overflow-hidden" aria-label="Bientôt disponible">
        <div className="chrome flex items-center gap-2 border-b border-line px-4 py-2.5 font-mono text-[12px] text-muted">
          <IconTerminal size={16} className="text-accent" /> R1 · simulé
        </div>
        <pre className="m-0 overflow-x-auto bg-[#060A11] px-5 py-5 font-mono text-[14px] leading-[1.75] text-[#C9D4E5]">
          <span className="text-muted">R1 con0 is now available. Press RETURN to get started.</span>
          {'\n\n'}
          <span className="text-accent">R1&gt;</span> enable{'\n'}
          <span className="text-accent">R1#</span> show labs{'\n'}
          <span className="text-warn">% Module en préparation : challenges ACL, VLAN/trunk, OSPF et NAT.</span>
          {'\n'}
          <span className="text-accent">R1#</span> <span className="led inline-block h-4 w-2 align-middle bg-accent" aria-hidden />
        </pre>
        <div className="flex flex-col gap-3 px-6 py-5">
          <h2 className="text-lg font-semibold">Bientôt disponible</h2>
          <p className="m-0 max-w-prose text-text2">
            Le simulateur IOS proposera des challenges chronométrés avec vérification ligne à ligne des commandes. En attendant, les
            questions de type CLI des examens blancs et de l'entraînement libre utilisent déjà le même moteur de correction.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/examen/nouveau?mode=practice" className="btn-primary">
              S'entraîner sur des questions
            </Link>
            <Link to="/labs/subnetting" className="btn-secondary">
              Subnetting trainer
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
