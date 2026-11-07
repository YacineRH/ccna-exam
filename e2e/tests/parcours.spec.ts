import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { bankOf, certificationOf, maxDrawableForTypes, questionByStem, shortExamPlan } from '../support/content';

/*
 * Parcours complet d'un candidat, dans l'ordre : chaque test s'appuie sur l'état laissé par
 * le précédent (compte créé, tentatives…). La base est vidée au démarrage de l'API de test.
 */
test.describe.configure({ mode: 'serial' });

const USER = { name: 'Camille Martin', email: 'camille@example.test', password: 'mot-de-passe-e2e-solide' };
const STORAGE_KEY = 'examforge.certification';
/** Seconde certification, déclarée par simple configuration, pour éprouver le sélecteur. */
const DEMO = {
  code: 'zz-e2e-demo',
  name: 'Certification de démonstration',
  vendor: 'ExamForge',
  examCode: 'E2E-1',
  domains: [{ code: 'A', name: 'Domaine unique', weight: 1 }],
  scoring: { min: 0, max: 100, passing: 70 },
  examFormat: { questionCount: 10, durationMinutes: 15, allowBackNavigation: true },
  allowedQuestionTypes: ['mcq_single'],
};

interface Cert {
  code: string;
  name: string;
  vendor: string;
  examCode: string;
}

let context: BrowserContext;
let page: Page;
let cert: Cert;
let examAttemptId = '';
let practiceAttemptId = '';

const newContext = (browser: Browser, options: Parameters<Browser['newContext']>[0] = {}) =>
  browser.newContext({ baseURL: test.info().project.use.baseURL, locale: 'fr-FR', ...options });

test.beforeAll(async ({ browser }) => {
  context = await newContext(browser);
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

const headerSelect = () => page.locator('header').getByLabel('Certification active');
const stemText = async () => ((await page.locator('#enonce').textContent()) ?? '').trim();
const correction = () => page.getByRole('region', { name: 'Correction' });
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clockSeconds = (text: string) => {
  const m = text.match(/(\d{2}):(\d{2}):(\d{2})/);
  if (!m) throw new Error(`Chrono illisible : ${text}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

/** Démarre un entraînement ciblé par l'API (filtre `types`) puis l'ouvre dans l'interface. */
async function startPractice(type: string): Promise<string> {
  const res = await page.request.post('/api/v1/attempts', {
    data: { certification: cert.code, mode: 'practice', questionCount: 1, types: [type] },
  });
  expect(res.status()).toBe(201);
  const state = (await res.json()) as { id: string; questions: { body: { type: string } }[] };
  expect(state.questions.map((q) => q.body.type)).toEqual([type]);
  await page.goto(`/tentatives/${state.id}`);
  await expect(page.locator('#enonce')).not.toBeEmpty();
  return state.id;
}

test('inscription, puis tableau de bord vide', async () => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/connexion$/);
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await page.getByLabel('Nom affiché').fill(USER.name);
  await page.getByLabel('E-mail').fill(USER.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(USER.password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Camille');
  await expect(page.getByText("Pas encore d'estimation.")).toBeVisible();
  await expect(page.getByText("Aucune session pour l'instant.")).toBeVisible();

  const list = (await (await page.request.get('/api/v1/certifications')).json()) as { certifications: Cert[] };
  cert = list.certifications[0]!;
  expect(cert).toBeDefined();
  await expect(headerSelect()).toHaveValue(cert.code);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('on vise');
});

test('sélecteur de certification : liste de l’API, choix mémorisé, repli', async () => {
  const created = await page.request.post('/api/v1/admin/certifications', { data: { config: DEMO } });
  expect(created.status()).toBe(201);
  await page.reload();

  const select = headerSelect();
  await expect(select.locator('option')).toHaveCount(2);
  await expect(select).toHaveValue(cert.code);

  await select.selectOption(DEMO.code);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`on vise ${DEMO.scoring.passing}.`);
  expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBe(DEMO.code);

  // Le choix survit à un rechargement et pilote le lancement.
  await page.goto('/examen/nouveau?mode=exam');
  await expect(headerSelect()).toHaveValue(DEMO.code);
  await expect(page.getByText(`${DEMO.examCode} · BANQUE : 0 QUESTION`)).toBeVisible();

  await headerSelect().selectOption(cert.code);
  await expect(page.getByText(new RegExp(`${escapeRe(cert.examCode)} · BANQUE : \\d+ QUESTIONS`))).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBe(cert.code);

  // Choix mémorisé devenu inconnu : repli sur la première certification.
  await page.evaluate((k) => localStorage.setItem(k, 'certification-retiree'), STORAGE_KEY);
  await page.reload();
  await expect(headerSelect()).toHaveValue(cert.code);
});

test('entraînement « ordre » : réordonner au clavier, valider, vérifier le retour', async () => {
  await startPractice('ordering');
  const q = questionByStem(cert.code, await stemText());
  if (q.body.type !== 'ordering' || q.key.type !== 'ordering') throw new Error('Question « ordre » attendue');
  const expected = q.key.order;
  expect(expected.length).toBeGreaterThanOrEqual(3);

  const order = () => page.locator('[data-order-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-order-item') ?? ''));
  const button = (id: string, dir: 'up' | 'down') => page.locator(`[data-order-item="${id}"] [data-dir="${dir}"]`);

  // « Descendre » au clavier : le premier élément passe deuxième et garde le focus.
  const before = await order();
  const first = before[0]!;
  await button(first, 'down').focus();
  await page.keyboard.press('Enter');
  await expect.poll(order).toEqual([before[1], first, ...before.slice(2)]);
  await expect(button(first, 'down')).toBeFocused();

  // « Monter » au clavier uniquement : tri par insertion, le focus suit l'élément déplacé.
  for (let target = 0; target < expected.length; target++) {
    const id = expected[target]!;
    let pos = (await order()).indexOf(id);
    if (pos > target) await button(id, 'up').focus();
    while (pos > target) {
      await page.keyboard.press('Space');
      pos -= 1;
      await expect.poll(async () => (await order()).indexOf(id)).toBe(pos);
      if (pos > 0) await expect(button(id, 'up')).toBeFocused();
    }
  }
  expect(await order()).toEqual(expected);

  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(correction()).toContainText('✓ BONNE RÉPONSE');
  await expect(correction()).toContainText('Explication');
  await expect(page.getByRole('button', { name: /^Terminer/ }).last()).toBeVisible();
});

test('entraînement « association » : choisir dans les listes, valider, vérifier le retour', async () => {
  practiceAttemptId = await startPractice('matching');
  const q = questionByStem(cert.code, await stemText());
  if (q.body.type !== 'matching' || q.key.type !== 'matching') throw new Error('Question « association » attendue');
  const { pairs } = q.key;
  const right = new Map(q.body.right.map((r) => [r.id, r.text]));
  const left = q.body.left;
  const choose = (leftText: string, rightId: string) =>
    page.getByLabel(leftText, { exact: true }).selectOption({ label: right.get(rightId)! });

  // Deux éléments de gauche dont les bonnes réponses diffèrent : on les inverse d'abord.
  const a = left[0]!;
  const b = left.find((l) => pairs[l.id] !== pairs[a.id])!;
  expect(b).toBeDefined();
  await choose(a.text, pairs[b.id]!);
  await choose(b.text, pairs[a.id]!);
  for (const l of left.filter((l) => l !== a && l !== b)) await choose(l.text, pairs[l.id]!);
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(correction()).toContainText('✕');
  await expect(correction()).toContainText(`Attendu : ${right.get(pairs[a.id]!)}`);

  // Corriger efface le retour ; une nouvelle validation donne la bonne réponse.
  await choose(a.text, pairs[a.id]!);
  await expect(correction()).toHaveCount(0);
  await choose(b.text, pairs[b.id]!);
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(correction()).toContainText('✓ BONNE RÉPONSE');
});

test('entraînement filtré par type, lancé depuis l’interface', async () => {
  const type = 'fill_blank';
  const inBank = bankOf(cert.code).filter((q) => q.body.type === type).length;
  const max = maxDrawableForTypes(cert.code, [type]);
  expect(max).toBeGreaterThanOrEqual(3);

  await page.goto('/examen/nouveau?mode=practice');
  await expect(page.getByRole('heading', { name: 'Nouvelle session' })).toBeVisible();
  await page.getByRole('button', { name: 'Aucun type' }).click();
  await expect(page.getByText('▲ Cochez au moins un type de question.')).toBeVisible();
  await expect(page.getByRole('button', { name: "Démarrer l'entraînement" })).toBeDisabled();

  const box = page.getByRole('checkbox', { name: /^Texte à compléter/ });
  await box.check();
  await expect(page.locator('label').filter({ has: box })).toContainText(`${inBank} questions dans les domaines cochés`);
  // La faisabilité tient compte du type : domaines sans question de ce type écartés, poids renormalisés.
  await expect(page.locator('#count-help')).toContainText(`au plus ${max} questions avec les domaines et les types retenus`);
  await expect(page.locator('#count')).toHaveValue(String(Math.min(10, max)));

  await page.locator('#count').fill('3');
  await page.getByRole('button', { name: "Démarrer l'entraînement" }).click();
  await expect(page).toHaveURL(/\/tentatives\/[0-9a-f-]{36}$/);
  for (let n = 1; n <= 3; n++) {
    await expect(page.getByText(`Question ${n} / 3`)).toBeVisible();
    await expect(page.getByText('TEXTE À COMPLÉTER', { exact: true })).toBeVisible();
    expect(questionByStem(cert.code, await stemText()).body.type).toBe(type);
    if (n < 3) await page.getByRole('button', { name: /^Suivant/ }).click();
  }
});

test('examen court : chrono, marquage, soumission, mêmes lettres dans les résultats', async () => {
  const plan = shortExamPlan(cert.code);
  expect(plan.count).toBeLessThanOrEqual(6);
  // Le poste retarde de 10 minutes sur le serveur : le chrono doit quand même afficher le vrai temps restant.
  await context.clock.install({ time: Date.now() - 10 * 60_000 });

  await page.goto('/examen/nouveau?mode=exam');
  await page.getByRole('button', { name: 'Tout décocher' }).click();
  await page.getByRole('checkbox', { name: new RegExp(`^${escapeRe(plan.domain)}`) }).check();
  await page.locator('#count').fill(String(plan.count));
  await expect(page.getByText('Durée accordée')).toBeVisible();
  await page.getByRole('button', { name: "Démarrer l'examen blanc" }).click();

  await expect(page).toHaveURL(/\/tentatives\/[0-9a-f-]{36}$/);
  examAttemptId = page.url().split('/').pop()!;
  const state = (await (await page.request.get(`/api/v1/attempts/${examAttemptId}`)).json()) as {
    certification: string;
    startedAt: string;
    deadlineAt: string;
  };
  expect(state.certification).toBe(cert.code);
  const allowed = (Date.parse(state.deadlineAt) - Date.parse(state.startedAt)) / 1000;

  // Chrono affiché, juste malgré le décalage d'horloge, et qui décompte.
  const timer = page.getByRole('timer');
  await expect(timer).toBeVisible();
  const shown = clockSeconds((await timer.textContent()) ?? '');
  expect(shown).toBeLessThanOrEqual(allowed);
  expect(shown).toBeGreaterThan(allowed - 60);
  await expect.poll(async () => clockSeconds((await timer.textContent()) ?? ''), { timeout: 5_000 }).toBeLessThan(shown);

  // Marquage pour révision de la première question.
  await page.getByRole('button', { name: 'Marquer pour révision' }).click();
  await expect(page.getByRole('button', { name: 'Marquée pour révision' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('1 marquée')).toBeVisible();

  // On répond à chaque QCM par la 2e option, en notant les lettres affichées.
  const seen = new Map<string, { options: { letter: string; text: string }[]; picked: string }>();
  for (let n = 1; n <= plan.count; n++) {
    await expect(page.getByText(`Question ${n} / ${plan.count}`)).toBeVisible();
    const q = questionByStem(cert.code, await stemText());
    if (q.body.type === 'mcq_single' || q.body.type === 'mcq_multi') {
      const role = q.body.type === 'mcq_multi' ? 'checkbox' : 'radio';
      const buttons = page.getByRole('main').getByRole(role);
      const options = await buttons.evaluateAll((els) =>
        els.map((e) => {
          const m = (e.textContent ?? '').match(/([A-Z])\.([\s\S]+)$/);
          return { letter: m?.[1] ?? '?', text: (m?.[2] ?? '').trim() };
        }),
      );
      expect(options.map((o) => o.letter)).toEqual(options.map((_, i) => String.fromCharCode(65 + i)));
      await buttons.nth(1).click();
      await expect(buttons.nth(1)).toHaveAttribute('aria-checked', 'true');
      seen.set(q.body.stem, { options, picked: options[1]!.letter });
    }
    if (n < plan.count) await page.getByRole('button', { name: /^Suivant/ }).click();
  }
  // Tirage aléatoire dans le domaine : au moins un QCM pour vérifier les lettres (les QCM y dominent).
  expect(seen.size).toBeGreaterThan(0);

  await page.getByRole('button', { name: /^Terminer →/ }).click();
  const dialog = page.getByRole('dialog', { name: "Terminer l'examen ?" });
  await expect(dialog).toContainText('marquée pour révision');
  await dialog.getByRole('button', { name: 'Terminer et voir le résultat' }).click();

  await expect(page).toHaveURL(new RegExp(`/tentatives/${examAttemptId}/resultat$`));
  await expect(page.getByText('Score final')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marquées (1)' })).toBeVisible();
  await page.getByRole('button', { name: /^Toutes \(/ }).click();

  for (const [stem, rec] of seen) {
    const card = page.locator('article').filter({ hasText: stem });
    const toggle = card.locator('h3 button');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const rows = card.locator('[data-tag]');
    await expect(rows).toHaveCount(rec.options.length);
    const got = await rows.evaluateAll((els) => els.map((e) => ({ tag: e.getAttribute('data-tag'), text: e.textContent ?? '' })));
    // Mêmes lettres, mêmes textes, dans le même ordre que pendant l'examen.
    expect(got.map((g) => g.tag)).toEqual(rec.options.map((o) => o.letter));
    rec.options.forEach((o, i) => expect(got[i]!.text).toContain(o.text));
    await expect(rows.filter({ hasText: 'votre choix' })).toHaveAttribute('data-tag', rec.picked);
  }
});

test('« Réviser » depuis le tableau de bord, après un examen raté', async () => {
  const result = (await (await page.request.get(`/api/v1/attempts/${examAttemptId}/result`)).json()) as { passed: boolean };
  expect(result.passed).toBe(false);
  const stats = (await (await page.request.get(`/api/v1/stats?certification=${cert.code}`)).json()) as {
    toReview: { subtopic: string | null; subtopicName: string | null }[];
  };
  const first = stats.toReview.find((t) => t.subtopic !== null);
  expect(first).toBeDefined();
  const subtopic = first!.subtopic!;
  const size = Math.min(10, bankOf(cert.code).filter((q) => q.subtopic === subtopic).length);

  await page.goto('/');
  const card = page.getByRole('region', { name: 'À revoir · priorisé' });
  await expect(card).toBeVisible();
  const button = card.getByRole('button', { name: `Réviser ${first!.subtopicName} (${size} question${size > 1 ? 's' : ''})` });
  await button.click();

  // Entraînement lancé directement, sans passer par l'écran de lancement.
  await expect(page).toHaveURL(/\/tentatives\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Entraînement libre', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(`Question 1 / ${size}`)).toBeVisible();
  const id = page.url().split('/').pop()!;
  const state = (await (await page.request.get(`/api/v1/attempts/${id}`)).json()) as { mode: string; questions: { body: { stem: string } }[] };
  expect(state.mode).toBe('practice');
  expect(state.questions).toHaveLength(size);
  for (const q of state.questions) expect(questionByStem(cert.code, q.body.stem).subtopic).toBe(subtopic);
});

test('examen blanc complet : toutes les questions et le chrono officiel, soumis sans tout répondre', async () => {
  const { examFormat } = certificationOf(cert.code);
  await page.goto('/examen/nouveau?mode=exam');
  await expect(page.locator('#count')).toHaveValue(String(examFormat.questionCount));
  await expect(page.locator('#count-help')).toContainText(`Durée accordée : ${examFormat.durationMinutes} min`);
  await page.getByRole('button', { name: "Démarrer l'examen blanc" }).click();
  await expect(page).toHaveURL(/\/tentatives\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;

  await expect(page.getByText(`Question 1 / ${examFormat.questionCount}`)).toBeVisible();
  const grid = page.getByRole('complementary', { name: 'Navigateur de questions' });
  // Sans retour arrière, les cases du navigateur sont des images étiquetées, pas des boutons.
  await expect(grid.locator('[aria-label^="Question "]')).toHaveCount(examFormat.questionCount);
  const timer = page.getByRole('timer');
  const shown = clockSeconds((await timer.textContent()) ?? '');
  expect(shown).toBeLessThanOrEqual(examFormat.durationMinutes * 60);
  expect(shown).toBeGreaterThan(examFormat.durationMinutes * 60 - 60);

  // Une seule réponse si la première question est un QCM, puis on passe à la suivante et on termine.
  const q = questionByStem(cert.code, await stemText());
  let answered = 0;
  if (q.body.type === 'mcq_single' || q.body.type === 'mcq_multi') {
    await page.getByRole('main').getByRole(q.body.type === 'mcq_multi' ? 'checkbox' : 'radio').first().click();
    answered = 1;
  }
  await page.getByRole('button', { name: /^Suivant/ }).click();
  await expect(page.getByText(`Question 2 / ${examFormat.questionCount}`)).toBeVisible();
  await page.getByRole('button', { name: "Terminer l'examen" }).click();
  const dialog = page.getByRole('dialog', { name: "Terminer l'examen ?" });
  await expect(dialog).toContainText(`${examFormat.questionCount - answered} questions sans réponse`);
  await dialog.getByRole('button', { name: 'Terminer et voir le résultat' }).click();

  await expect(page).toHaveURL(new RegExp(`/tentatives/${id}/resultat$`));
  await expect(page.getByText('Score final')).toBeVisible();
  const result = (await (await page.request.get(`/api/v1/attempts/${id}/result`)).json()) as { status: string; totalCount: number };
  expect(result).toMatchObject({ status: 'submitted', totalCount: examFormat.questionCount });
});

test('à 390 px de large : aucun débordement horizontal', async ({ browser }) => {
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

  const expectNoOverflow = async (p: Page, where: string) => {
    const size = await p.evaluate(() => ({
      scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      client: document.documentElement.clientWidth,
    }));
    expect(size.scroll, `débordement horizontal : ${where}`).toBeLessThanOrEqual(size.client);
  };

  const anon = await newContext(browser, mobile);
  const login = await anon.newPage();
  await login.goto('/connexion');
  await expect(login.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  await expectNoOverflow(login, '/connexion');
  await anon.close();

  const signedIn = await newContext(browser, { ...mobile, storageState: await context.storageState() });
  const p = await signedIn.newPage();
  const pages: { path: string; ready: () => Locator }[] = [
    { path: '/', ready: () => p.getByText('Indice de préparation') },
    { path: '/examen/nouveau?mode=exam', ready: () => p.getByRole('heading', { name: 'Nouvelle session' }) },
    { path: '/examen/nouveau?mode=practice', ready: () => p.getByRole('heading', { name: 'Nouvelle session' }) },
    { path: '/historique', ready: () => p.getByRole('heading', { name: 'Historique' }) },
    { path: `/tentatives/${examAttemptId}/resultat`, ready: () => p.getByText('Score final') },
    { path: `/tentatives/${practiceAttemptId}`, ready: () => p.locator('#enonce') },
    { path: '/labs/subnetting', ready: () => p.getByRole('heading', { level: 1 }) },
    { path: '/labs/cli', ready: () => p.getByRole('heading', { level: 1 }) },
  ];
  for (const { path, ready } of pages) {
    await p.goto(path);
    await expect(ready().first()).toBeVisible();
    await expectNoOverflow(p, path);
  }

  // Menu mobile : il contient le sélecteur de certification.
  await p.goto('/');
  await p.getByRole('button', { name: 'Ouvrir le menu' }).click();
  const menuSelect = p.locator('#menu-principal').getByLabel('Certification active');
  await expect(menuSelect).toBeVisible();
  await expect(menuSelect).toHaveValue(cert.code);
  await expectNoOverflow(p, 'menu ouvert');
  await signedIn.close();
});
