import { expect, test, type Page } from '@playwright/test';
import { labOf } from '../support/content';

/*
 * Test de fumée, joué dans Chromium, Firefox et WebKit : connexion, examen court, lab au clavier.
 * Le premier navigateur crée le compte (premier compte de la base), les suivants s'y connectent.
 */
const USER = { name: 'Fumée', email: 'fumee@example.test', password: 'mot-de-passe-fumee-solide' };
const LAB_SLUG = 'ccna-lab-1.3-interfaces';

async function signIn(page: Page) {
  await page.request.post('/api/v1/auth/register', { data: { email: USER.email, password: USER.password, displayName: USER.name } });
  // L'inscription ouvre une session : on la ferme pour passer par l'écran de connexion.
  await page.context().clearCookies();
  await page.goto('/connexion');
  await page.getByLabel('E-mail').fill(USER.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(USER.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText('Indice de préparation')).toBeVisible();
}

test('connexion, examen court, lab', async ({ page }) => {
  await signIn(page);

  // Examen court de 3 questions : on répond aux QCM, on soumet, le résultat s'affiche.
  const res = await page.request.post('/api/v1/attempts', { data: { certification: 'ccna', mode: 'exam', questionCount: 3 } });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/tentatives/${id}`);
  for (let n = 1; n <= 3; n++) {
    await expect(page.getByText(`Question ${n} / 3`)).toBeVisible();
    const option = page.getByRole('main').getByRole('radio').first();
    if (await option.count()) await option.click();
    if (n < 3) await page.getByRole('button', { name: /^Suivant/ }).click();
  }
  await page.getByRole('button', { name: /^Terminer →/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Terminer et voir le résultat' }).click();
  await expect(page.getByText('Score final')).toBeVisible();

  // Lab : quelques commandes au clavier, un objectif coché, puis la fin.
  const lab = labOf('ccna', LAB_SLUG);
  await page.goto(`/labs/cli/${LAB_SLUG}`);
  await page.getByRole('button', { name: /Démarrer le lab|Nouvelle session/ }).click();
  const input = page.getByRole('textbox', { name: /Commande pour R1/ });
  for (const line of ['enable', 'conf t', 'int g0/0/0', 'ip address 192.168.10.1 255.255.255.192']) {
    await input.fill(line);
    await input.press('Enter');
    await expect(input).toHaveValue('');
  }
  await expect(page.getByRole('list', { name: 'Objectifs du lab' }).getByText('Atteint :')).toHaveCount(1);
  await page.getByRole('button', { name: 'Terminer le lab' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Terminer et voir la solution' }).click();
  await expect(page.getByRole('heading', { name: 'Solution' })).toBeVisible();
  await expect(page.getByText(lab.title).first()).toBeVisible();
});
