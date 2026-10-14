import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db', JWT_SECRET: 'x'.repeat(40) };

describe('configuration', () => {
  it('garde le cookie « Secure » par défaut', () => {
    expect(loadEnv(base).COOKIE_SECURE).toBe(true);
  });

  it('permet de le désactiver explicitement pour un test en HTTP sur le réseau local', () => {
    expect(loadEnv({ ...base, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });

  it('refuse un secret de session trop court', () => {
    expect(() => loadEnv({ ...base, JWT_SECRET: 'court' })).toThrow(/JWT_SECRET/);
  });
});
