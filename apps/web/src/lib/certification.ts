import type { CertificationSummary, Module } from './types';

/** Clé localStorage du choix de certification. */
export const CERTIFICATION_STORAGE_KEY = 'examforge.certification';

/** Libellé court : nom court de la certification (ou son code en capitales), puis code d’examen. */
export function certificationLabel(c: Pick<CertificationSummary, 'code' | 'examCode'> & { shortName?: string }): string {
  return `${c.shortName ?? c.code.toUpperCase()} ${c.examCode}`.trim();
}

/** La certification propose-t-elle ce module ? Sans liste (ancienne API), seuls les modules par défaut. */
export function hasModule(c: { modules?: readonly Module[] } | null | undefined, module: Module): boolean {
  return (c?.modules ?? DEFAULT_MODULES).includes(module);
}

/** Modules d'une certification déclarée sans liste (même valeur que `DEFAULT_MODULES` de packages/core). */
export const DEFAULT_MODULES: readonly Module[] = ['exam', 'practice', 'flashcards'];

/**
 * Certification à activer : celle mémorisée si elle existe encore, sinon la première de la liste
 * (ordre de l'API). `null` seulement si aucune certification n'est disponible.
 */
export function pickCertification(list: readonly Pick<CertificationSummary, 'code'>[], stored: string | null): string | null {
  if (stored && list.some((c) => c.code === stored)) return stored;
  return list[0]?.code ?? null;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Accès refusé (navigation privée stricte, cookies bloqués…).
    return null;
  }
}

/** Lit le choix mémorisé ; jamais d'exception (stockage indisponible = pas de choix). */
export function readStoredCertification(storage: StorageLike | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(CERTIFICATION_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Mémorise le choix ; un stockage plein ou interdit est ignoré (le choix vaut pour la session). */
export function storeCertification(code: string, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(CERTIFICATION_STORAGE_KEY, code);
  } catch {
    /* ignoré */
  }
}
