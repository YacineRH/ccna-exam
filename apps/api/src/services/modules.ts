import { DEFAULT_MODULES, type CertificationConfig, type Module } from '@examforge/core';
import { HttpError } from '../errors.js';

/** Modules proposés par une certification. Une configuration enregistrée sans liste garde les modules par défaut. */
export function modulesOf(config: Pick<CertificationConfig, 'code'> & { modules?: readonly Module[] }): readonly Module[] {
  return config.modules ?? DEFAULT_MODULES;
}

export const moduleUnavailable = (code: string, module: Module) =>
  new HttpError(404, 'module_unavailable', `La certification ${code} ne propose pas le module ${module}`, { certification: code, module });

/** Lève un 404 `module_unavailable` si la certification ne propose pas ce module. */
export function requireModule(cert: { code: string; config: CertificationConfig }, module: Module): void {
  if (!modulesOf(cert.config).includes(module)) throw moduleUnavailable(cert.code, module);
}

/** Module d'un lab : les challenges ont le leur, le reste relève du simulateur de terminal. */
export const labModule = (kind: 'lab' | 'challenge'): Module => (kind === 'challenge' ? 'challenges' : 'cli');
