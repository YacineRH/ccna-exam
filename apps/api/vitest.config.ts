import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Les fichiers de test partagent la même base : ils tournent l'un après l'autre.
  test: { testTimeout: 20_000, hookTimeout: 60_000, fileParallelism: false },
});
