import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * Test de fumée dans les trois moteurs : connexion, examen court, lab. Firefox et WebKit ne sont pas
 * préinstallés dans les conteneurs de session ; la CI les installe dans un job non bloquant.
 * `E2E_BROWSERS=chromium` restreint la liste (en local, par exemple).
 */
const wanted = (process.env.E2E_BROWSERS ?? 'chromium,firefox,webkit').split(',');
const all = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
];

export default defineConfig({
  ...base,
  testDir: './smoke',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-browsers' }]] : 'list',
  projects: all.filter((p) => wanted.includes(p.name)),
});
