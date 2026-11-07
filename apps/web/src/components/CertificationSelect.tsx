import { useId } from 'react';
import { useCertification } from '../certification/CertificationContext';
import { certificationLabel } from '../lib/certification';
import { IconChevronDown } from './Icons';
import { Led } from './ui';

/** Sélecteur de la certification active (en-tête et menu mobile). */
export function CertificationSelect({ className = '' }: { className?: string }) {
  const { certifications, current, select, loading, error } = useCertification();
  const id = useId();

  if (!current) {
    return (
      <span
        className={`h-11 items-center gap-2 rounded-lg border border-line px-3 font-mono text-[13px] font-medium text-muted ${className}`}
        style={{ background: 'rgba(16,24,39,.8)' }}
      >
        <Led color={error != null ? '#FF6B5E' : '#4A5B78'} />
        {loading ? 'Chargement…' : error != null ? 'Indisponible' : 'Aucune certification'}
      </span>
    );
  }

  return (
    <span
      className={`relative h-11 items-center rounded-lg border border-line font-mono text-[13px] font-medium focus-within:border-accent ${className}`}
      style={{ background: 'rgba(16,24,39,.8)' }}
      title={current.name}
    >
      <span className="pointer-events-none absolute left-3 flex items-center">
        <Led />
      </span>
      <label htmlFor={id} className="sr-only">
        Certification active
      </label>
      <select
        id={id}
        value={current.code}
        onChange={(e) => select(e.target.value)}
        className="h-full w-full min-w-0 cursor-pointer appearance-none rounded-lg border-0 bg-transparent pl-7 pr-8 text-text outline-none"
      >
        {certifications.map((c) => (
          <option key={c.code} value={c.code} className="bg-chrome text-text">
            {certificationLabel(c)}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 flex items-center text-muted">
        <IconChevronDown />
      </span>
    </span>
  );
}
