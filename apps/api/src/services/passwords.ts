import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';

/** Paramètres argon2id recommandés par l'OWASP (19 Mio, 2 passes). */
export const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 12;

export const hashPassword = (password: string) => hash(password, ARGON);

/**
 * Mot de passe aléatoire pour un compte créé par l'administrateur : 18 octets de `crypto`, en base64url
 * (24 caractères, sans « + », « / » ni « = » : il se copie et se dicte sans ambiguïté).
 */
export const generatePassword = () => randomBytes(18).toString('base64url');
