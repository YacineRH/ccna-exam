import { defineConfig } from 'vitest/config';

// Tests unitaires des utilitaires purs : pas de DOM nécessaire.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
