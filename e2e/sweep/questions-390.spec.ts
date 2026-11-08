import { expect, test, type Page } from '@playwright/test';
import { listCertificationCodes } from '@examforge/content';
import { bankOf, certificationOf } from '../support/content';

/*
 * Chaque question de la banque est affichée à 390 px de large, pendant la tentative puis dans
 * le post-mortem, et l'on vérifie qu'aucune ne crée de défilement horizontal. Les questions sont
 * tirées sous-thème par sous-thème (filtre `subtopics`), pour toutes les voir sans hasard.
 * Une passe par certification du dépôt ; `SWEEP_CERTIFICATION=<code>` n'en garde qu'une.
 */
const CERTS = process.env.SWEEP_CERTIFICATION ? [process.env.SWEEP_CERTIFICATION] : listCertificationCodes();
const USER = { name: 'Balayage', email: 'balayage@example.test', password: 'mot-de-passe-balayage-solide' };

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR' });

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
}

for (const CERT of CERTS) {
  test(`toutes les questions de la banque ${CERT}, à 390 px`, async ({ page }) => {
    const bank = bankOf(CERT);
    const subtopics = [...new Set(bank.map((q) => q.subtopic).filter((s): s is string => !!s))];
    const res = await page.request.post('/api/v1/auth/register', { data: { displayName: USER.name, email: USER.email, password: USER.password } });
    expect([201, 403]).toContain(res.status());
    if (res.status() === 403) await page.request.post('/api/v1/auth/login', { data: { email: USER.email, password: USER.password } });

    const offenders: string[] = [];
    let seen = 0;
    for (const subtopic of subtopics) {
      const count = bank.filter((q) => q.subtopic === subtopic).length;
      const start = await page.request.post('/api/v1/attempts', {
        data: { certification: CERT, mode: 'practice', questionCount: count, subtopics: [subtopic] },
      });
      expect(start.status(), `sous-thème ${subtopic}`).toBe(201);
      const { id } = (await start.json()) as { id: string };
      await page.goto(`/tentatives/${id}`);
      for (let i = 1; i <= count; i++) {
        await expect(page.getByText(`Question ${i} / ${count}`)).toBeVisible();
        await expect(page.locator('#enonce')).not.toBeEmpty();
        const stem = ((await page.locator('#enonce').textContent()) ?? '').trim().slice(0, 60);
        if ((await overflow(page)) > 0) offenders.push(`${subtopic} q${i} : ${stem}`);
        seen++;
        if (i < count) await page.getByRole('button', { name: /^Suivant/ }).click();
      }
      expect((await page.request.post(`/api/v1/attempts/${id}/submit`)).ok()).toBe(true);
      await page.goto(`/tentatives/${id}/resultat`);
      await expect(page.getByText('Score final').or(page.getByText('Résultats')).first()).toBeVisible();
      if ((await overflow(page)) > 0) offenders.push(`${subtopic} : post-mortem`);
    }
    // Les questions sans sous-thème ne sont pas tirées par ce filtre : on les compte à part.
    const without = bank.filter((q) => !q.subtopic).length;
    expect(seen + without, `banque ${certificationOf(CERT).code}`).toBe(bank.length);
    expect(offenders, 'questions qui débordent à 390 px').toEqual([]);
  });
}
