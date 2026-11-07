import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Balayage à 390 px de toutes les questions de la banque (et du post-mortem), hors de la suite
 * principale car il est long : `pnpm e2e:sweep`. Même API et même front que la suite e2e.
 */
const [api, web] = base.webServer as NonNullable<Extract<typeof base.webServer, unknown[]>>;

export default defineConfig({
  ...base,
  // Le balayage enchaîne des centaines d'enregistrements par minute : plafond de requêtes relevé.
  webServer: [{ ...api!, env: { ...api!.env, E2E_RATE_LIMIT_MAX: '100000' } }, web!],
  testDir: './sweep',
  timeout: 30 * 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-sweep' }]] : 'list',
});
