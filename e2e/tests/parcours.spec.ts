import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';
import { anotherChallenge, bankOf, certificationOf, labOf, maxDrawableForTypes, questionByStem, shortExamPlan, troubleshootChallenge } from '../support/content';

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
let labSessionId = '';
let challengeSessionId = '';
let revisionSessionId = '';
const LAB_SLUG = 'ccna-lab-1.3-interfaces';
const DB_URL = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? 'postgres://examforge:examforge@localhost:5432/examforge_test';

/** Accès direct à la base de test, seulement pour avancer l'horloge d'un essai (échéance). */
async function sql(text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

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

  // Une réponse à la première question si c'est un QCM, puis on passe à la suivante et on termine.
  // (Une question « ordre » a d'office une réponse : l'ordre affiché.)
  const q = questionByStem(cert.code, await stemText());
  if (q.body.type === 'mcq_single' || q.body.type === 'mcq_multi') {
    await page.getByRole('main').getByRole(q.body.type === 'mcq_multi' ? 'checkbox' : 'radio').first().click();
  }
  await page.getByRole('button', { name: /^Suivant/ }).click();
  await expect(page.getByText(`Question 2 / ${examFormat.questionCount}`)).toBeVisible();
  await page.getByRole('button', { name: "Terminer l'examen" }).click();
  const dialog = page.getByRole('dialog', { name: "Terminer l'examen ?" });
  await expect(dialog).toContainText(/\d+ questions sans réponse/);
  const unanswered = Number(((await dialog.textContent()) ?? '').match(/(\d+) questions sans réponse/)![1]);
  expect(unanswered).toBeGreaterThanOrEqual(examFormat.questionCount - 2);
  await dialog.getByRole('button', { name: 'Terminer et voir le résultat' }).click();

  await expect(page).toHaveURL(new RegExp(`/tentatives/${id}/resultat$`));
  await expect(page.getByText('Score final')).toBeVisible();
  const result = (await (await page.request.get(`/api/v1/attempts/${id}/result`)).json()) as {
    status: string;
    totalCount: number;
    review: { response: unknown }[];
  };
  expect(result).toMatchObject({ status: 'submitted', totalCount: examFormat.questionCount });
  expect(result.review.filter((r) => r.response === null)).toHaveLength(unanswered);
});

test('lab CLI au clavier : abréviations, erreur IOS, aide, indice, Ctrl+Z, fin avec la solution', async () => {
  const lab = labOf(cert.code, LAB_SLUG);
  await page.goto('/labs/cli');
  await expect(page.getByRole('heading', { name: 'CLI trainer' })).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: lab.title });
  await expect(row).toContainText('À FAIRE');
  // Filtre par sous-thème : seul ce sous-thème reste.
  await page.getByLabel('Sous-thème').selectOption(lab.subtopic);
  await expect(page.getByRole('listitem').filter({ hasText: lab.title })).toBeVisible();
  await row.getByRole('link', { name: `Ouvrir le lab ${lab.title}` }).click();
  await expect(page.getByRole('heading', { name: lab.title })).toBeVisible();
  await page.getByRole('button', { name: 'Démarrer le lab →' }).click();
  await expect(page).toHaveURL(/\/labs\/cli\/sessions\/[0-9a-f-]{36}$/);
  labSessionId = page.url().split('/').pop()!;

  const input = page.getByRole('textbox', { name: /Commande pour R1/ });
  const log = page.getByRole('log', { name: 'Sortie de R1' });
  const type = async (line: string) => {
    await input.fill(line);
    await input.press('Enter');
    await expect(input).toHaveValue('');
  };
  await input.focus();
  await type('en');
  await expect(page.getByText('R1#', { exact: true })).toBeVisible();
  await type('conf t');
  await type('interfce g0/0/0');
  await expect(log).toContainText("% Invalid input detected at '^' marker.");
  await type('int g0/0/0');
  // `?` affiche l'aide tout de suite, la ligne reste dans la saisie.
  await input.fill('ip add');
  await input.press('?');
  await expect(log).toContainText('address');
  await expect(input).toHaveValue('ip add');
  await input.fill('ip add 192.168.10.1 255.255.255.192');
  await input.press('Enter');
  await type('desc LAN utilisateurs');
  await type('no shut');
  // ↑ rappelle la dernière commande.
  await input.press('ArrowUp');
  await expect(input).toHaveValue('no shut');
  await input.fill('');

  const objectives = page.getByRole('list', { name: 'Objectifs du lab' });
  await expect(objectives.getByText('Atteint :')).toHaveCount(3);

  await page.getByRole('button', { name: 'Indice 1 sur 3' }).click();
  await expect(page.getByRole('region', { name: 'Indices' }).getByText(lab.hints[0]!)).toBeVisible();

  // Collage multi-ligne, puis Ctrl+Z et sauvegarde.
  await input.focus();
  await page.evaluate((text) => {
    const el = document.activeElement as HTMLInputElement;
    const data = new DataTransfer();
    data.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, 'int g0/0/1\ndesc Lien vers FAI\nip add 203.0.113.2 255.255.255.252\nno shut');
  await expect(log).toContainText('R1(config-if)#no shut');
  await input.press('Control+z');
  await expect(log).toContainText('^Z');
  await type('copy run start');
  await expect(objectives.getByText('Atteint :')).toHaveCount(lab.objectives.length);
  await expect(page.getByRole('status')).toContainText('Tous les objectifs sont atteints');

  await page.getByRole('button', { name: 'Terminer le lab' }).click();
  const end = page.getByRole('region', { name: 'Lab réussi' });
  await expect(end).toBeVisible();
  await expect(end).toContainText('✓ RÉUSSI');
  await expect(end.getByRole('heading', { name: 'Solution' })).toBeVisible();
  await expect(end).toContainText(lab.solution[0]!.commands[3]!);
  await expect(end).toContainText('desc LAN utilisateurs');
  await expect(end).not.toContainText('interfce g0/0/0');

  // Le lab est marqué fait dans la liste, et la session figure dans l'historique.
  await page.goto('/labs/cli');
  await expect(page.getByRole('listitem').filter({ hasText: lab.title })).toContainText('✓ FAIT');
  await page.goto('/historique');
  await page.getByRole('button', { name: /^Labs CLI/ }).click();
  const hist = page.getByRole('listitem').filter({ hasText: `Lab CLI · ${lab.title}` });
  await expect(hist).toContainText('✓ RÉUSSI');
  await expect(hist).toContainText('1 indice');
});

test('challenge de dépannage résolu au clavier avant l’échéance, puis classement mis à jour', async () => {
  const ch = troubleshootChallenge(cert.code);
  const steps = ch.solution[0]!;
  await page.goto('/challenges');
  await expect(page.getByRole('heading', { name: 'Challenges', level: 1 })).toBeVisible();
  await page.getByLabel('Mode').selectOption('troubleshoot');
  const row = page.getByRole('listitem').filter({ hasText: ch.title });
  await expect(row).toContainText('DÉPANNAGE');
  // Navigation au clavier : le lien du challenge, puis le départ.
  await row.getByRole('link', { name: `Ouvrir le challenge ${ch.title}` }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: ch.title, level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Le défi' })).toContainText(`${ch.challenge!.targetMinutes} min`);
  await expect(page.getByRole('region', { name: 'Vos temps' })).toContainText('Aucun essai réussi');
  await page.getByRole('button', { name: 'Lancer le chrono →' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/challenges\/sessions\/[0-9a-f-]{36}$/);
  challengeSessionId = page.url().split('/').pop()!;

  // Compte à rebours, pas d'indice.
  const timer = page.getByRole('timer');
  await expect(timer).toHaveAttribute('aria-live', 'off');
  await expect(timer).toHaveAttribute('aria-label', /Temps restant : 00:\d{2}:\d{2}/);
  await expect(page.getByRole('button', { name: /^Indice/ })).toHaveCount(0);

  const input = page.getByRole('textbox', { name: new RegExp(`Commande pour ${steps.device}`) });
  await input.focus();
  for (const command of steps.commands) {
    await page.keyboard.type(command === '\x1a' ? '' : command);
    if (command === '\x1a') await page.keyboard.press('Control+z');
    else await page.keyboard.press('Enter');
    if (command !== steps.commands.at(-1)) await expect(input).toHaveValue('');
  }
  // Tous les objectifs atteints : le challenge s'arrête seul, avec les pannes et la solution.
  const end = page.getByRole('region', { name: 'Challenge réussi' });
  await expect(end).toBeVisible();
  await expect(end).toContainText('✓ RÉUSSI');
  await expect(end.getByRole('heading', { name: 'Pannes semées dans la configuration de départ' })).toBeVisible();
  await expect(end).toContainText(ch.challenge!.faults[0]!);
  await expect(end.getByRole('heading', { name: 'Solution' })).toBeVisible();
  await expect(end).toContainText('1 essai réussi');

  // Classement personnel : meilleur temps dans la liste, essai dans l'historique.
  await page.goto('/challenges');
  const listed = page.getByRole('listitem').filter({ hasText: ch.title });
  await expect(listed).toContainText('⏱');
  await expect(listed.getByRole('link', { name: `Rejouer le challenge ${ch.title}` })).toBeVisible();
  await page.goto('/historique');
  await page.getByRole('button', { name: /^Challenges/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: `Challenge · ${ch.title}` })).toContainText('✓ RÉUSSI');
});

test('challenge expiré : fin automatique à l’échéance, écran de fin avec la solution', async () => {
  const solved = troubleshootChallenge(cert.code);
  const ch = anotherChallenge(cert.code, solved.slug);
  await page.goto(`/challenges/${ch.slug}`);
  await page.getByRole('button', { name: 'Lancer le chrono →' }).click();
  await expect(page).toHaveURL(/\/challenges\/sessions\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;
  const input = page.getByRole('textbox', { name: /Commande pour / });
  await input.fill('enable');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  // L'échéance est avancée à dans 4 secondes (côté serveur) : le compte à rebours se recale au rechargement.
  await sql(`update lab_attempts set deadline_at = now() + interval '4 seconds' where id = $1`, [id]);
  await page.reload();
  await expect(page.getByRole('timer')).toHaveAttribute('aria-label', /Temps restant : 00:00:0[0-4]/);
  const end = page.getByRole('region', { name: 'Temps écoulé' });
  await expect(end).toBeVisible({ timeout: 15_000 });
  await expect(end).toContainText('✕ NON RÉUSSI');
  await expect(end.getByRole('heading', { name: 'Solution' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /Commande pour / })).toHaveCount(0);
  // Côté serveur, l'essai est clos par l'échéance.
  const { rows } = await sql('select status, expired from lab_attempts where id = $1', [id]);
  expect(rows[0]).toMatchObject({ status: 'finished', expired: true });
});

test('session de révision : cartes dues, réponses, échéances recalculées', async () => {
  await page.goto('/revision');
  await expect(page.getByRole('heading', { name: 'À réviser aujourd’hui', level: 1 })).toBeVisible();
  const due = page.getByRole('region', { name: 'Cartes dues' });
  await expect(due).toContainText('Ajoutez un paquet');
  // Ajouter un paquet : ses cartes sont dues tout de suite.
  const available = page.getByRole('region', { name: 'Paquets disponibles' });
  const first = available.getByRole('button', { name: /^Ajouter le paquet / }).first();
  const deckName = ((await first.getAttribute('aria-label')) ?? '').replace('Ajouter le paquet ', '');
  await first.click();
  const mine = page.getByRole('region', { name: 'Vos paquets' });
  await expect(mine.getByRole('listitem').filter({ hasText: deckName })).toContainText(/DUES?/);
  const count = Number((await due.locator('p').first().textContent())?.trim());
  expect(count).toBeGreaterThanOrEqual(3);

  await page.getByRole('button', { name: /^Session rapide/ }).click();
  await expect(page).toHaveURL(/\/revision\/sessions\/[0-9a-f-]{36}$/);
  revisionSessionId = page.url().split('/').pop()!;

  // Deux cartes QCM : une bonne réponse (tirée de la banque), puis une réponse quelconque ; les autres types sont passés.
  let answered = 0;
  for (let i = 0; answered < 2 && i < count; i++) {
    const stem = ((await page.locator('#card-h ~ p').first().textContent()) ?? '').trim();
    const q = questionByStem(cert.code, stem);
    if (q.key.type === 'mcq_single' && answered === 0) {
      const text = q.body.type === 'mcq_single' ? q.body.options.find((o) => o.id === (q.key as { correct: string }).correct)!.text : '';
      await page.getByRole('radio', { name: new RegExp(escapeRe(text)) }).click();
    } else if (q.body.type === 'mcq_single' || q.body.type === 'mcq_multi') {
      const n = q.body.type === 'mcq_multi' ? q.body.selectCount : 1;
      const role = q.body.type === 'mcq_multi' ? 'checkbox' : 'radio';
      for (let k = 0; k < n; k++) await page.getByRole(role).nth(k).click();
    } else {
      await page.getByRole('button', { name: 'Passer' }).click();
      continue;
    }
    await page.getByRole('button', { name: 'Valider' }).click();
    answered++;
    const fb = page.getByRole('region', { name: 'Correction' });
    await expect(fb).toContainText(/BONNE RÉPONSE|RÉPONSE INCORRECTE/);
    await expect(fb).toContainText('Explication');
    // Juste ou faux, la carte revient demain (boîte 1).
    await expect(fb).toContainText('Boîte 1/7 · prochaine révision demain');
    await expect(page.getByRole('button', { name: /Carte suivante|Voir le bilan/ })).toBeFocused();
    await page.keyboard.press('Enter');
  }
  // Les cartes répondues ne sont plus dues aujourd'hui.
  await page.goto('/revision');
  await expect(page.getByRole('region', { name: 'Cartes dues' }).locator('p').first()).not.toHaveText(String(count));
  await page.goto('/historique');
  await page.getByRole('button', { name: /^Révision/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Révision · cartes dues' })).toBeVisible();
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
    { path: `/labs/cli/${LAB_SLUG}`, ready: () => p.getByText('Topologie') },
    { path: `/labs/cli/sessions/${labSessionId}`, ready: () => p.getByRole('heading', { name: 'Solution' }) },
    { path: '/challenges', ready: () => p.getByRole('heading', { level: 1 }) },
    { path: `/challenges/${troubleshootChallenge(cert.code).slug}`, ready: () => p.getByText('Topologie') },
    { path: `/challenges/sessions/${challengeSessionId}`, ready: () => p.getByRole('heading', { name: 'Solution' }) },
    { path: '/revision', ready: () => p.getByRole('heading', { level: 1 }) },
    { path: `/revision/sessions/${revisionSessionId}`, ready: () => p.getByRole('heading', { level: 1 }) },
  ];
  const small: string[] = [];
  for (const { path, ready } of pages) {
    await p.goto(path);
    await expect(ready().first()).toBeVisible();
    await expectNoOverflow(p, path);
    // Zones tactiles : chaque bouton, champ et lien-bouton visible fait au moins 44 px de haut.
    const tiny = await p.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('button, select, input:not([type=checkbox]):not([type=radio]), a.btn-primary, a.btn-secondary, [role=tab]'))
        .filter((el) => el.offsetParent !== null && !el.closest('.sr-only'))
        .map((el) => ({ h: el.getBoundingClientRect().height, text: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40) }))
        .filter((x) => x.h > 0 && x.h < 44 && !/^Commande pour/.test(x.text)),
    );
    for (const t of tiny) small.push(`${path} : « ${t.text} » (${Math.round(t.h)} px)`);
  }
  expect(small, 'zones cliquables de moins de 44 px').toEqual([]);

  // Menu mobile : il contient le sélecteur de certification.
  await p.goto('/');
  await p.getByRole('button', { name: 'Ouvrir le menu' }).click();
  const menuSelect = p.locator('#menu-principal').getByLabel('Certification active');
  await expect(menuSelect).toBeVisible();
  await expect(menuSelect).toHaveValue(cert.code);
  await expectNoOverflow(p, 'menu ouvert');
  await signedIn.close();
});

test('mise en page à 360, 390, 768 et 1280 px : examen, résultats, tableau de bord, lab', async ({ browser }) => {
  const res = await page.request.post('/api/v1/attempts', { data: { certification: cert.code, mode: 'exam', questionCount: 2 } });
  const running = ((await res.json()) as { id: string }).id;
  const problems: string[] = [];
  for (const width of [360, 390, 768, 1280]) {
    const ctx = await newContext(browser, {
      viewport: { width, height: width < 768 ? 800 : 900 },
      ...(width < 768 ? { isMobile: true, hasTouch: true } : {}),
      storageState: await context.storageState(),
    });
    const p = await ctx.newPage();
    const screens: { path: string; ready: () => Locator }[] = [
      { path: `/tentatives/${running}`, ready: () => p.locator('#enonce') },
      { path: `/tentatives/${examAttemptId}/resultat`, ready: () => p.getByText('Score final') },
      { path: '/', ready: () => p.getByText('Indice de préparation') },
      { path: `/labs/cli/${LAB_SLUG}`, ready: () => p.getByText('Topologie') },
    ];
    for (const { path, ready } of screens) {
      await p.goto(path);
      await expect(ready().first()).toBeVisible();
      const m = await p.evaluate(() => ({
        scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        client: document.documentElement.clientWidth,
        // Un titre ou un bouton coupé hors de l'écran.
        clipped: Array.from(document.querySelectorAll<HTMLElement>('h1, button, a.btn-primary, a.btn-secondary'))
          .filter((el) => el.offsetParent !== null)
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.right > document.documentElement.clientWidth + 1 || r.left < -1;
          })
          .map((el) => (el.textContent ?? '').trim().slice(0, 30)),
      }));
      if (m.scroll > m.client) problems.push(`${width} px ${path} : débordement (${m.scroll} > ${m.client})`);
      for (const c of m.clipped) problems.push(`${width} px ${path} : « ${c} » hors de l'écran`);
    }
    // Le terminal sur mobile : la barre d'actions tactile, une saisie à 16 px (pas de zoom).
    await p.goto(`/labs/cli/${LAB_SLUG}`);
    await p.getByRole('button', { name: /Démarrer le lab|Nouvelle session/ }).click();
    const input = p.getByRole('textbox', { name: /Commande pour R1/ });
    await expect(input).toBeVisible();
    const bar = p.getByRole('toolbar', { name: 'Touches du terminal' });
    if (width < 768) {
      await expect(bar).toBeVisible();
      expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
      await input.fill('en');
      await bar.getByRole('button', { name: 'Compléter le mot (Tab)' }).click();
      await expect(input).toHaveValue('enable ');
      await input.press('Enter');
      await bar.getByRole('button', { name: 'Commande précédente' }).click();
      await expect(input).toHaveValue('enable');
      await expect(input).toBeFocused();
    } else {
      await expect(bar).toBeHidden();
    }
    await ctx.close();
  }
  expect(problems).toEqual([]);
});

/** Violations « serious » ou « critical » (WCAG 2.1 A et AA) d'une page, en texte lisible. */
async function axeViolations(p: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id} : ${v.help}\n${v.nodes.slice(0, 8).map((n) => `  ${n.html.slice(0, 200)} — ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`).join('\n')}`);
}

/** Hiérarchie des titres : un seul h1, et aucun niveau sauté (h2 → h4). */
async function headingProblems(p: Page): Promise<string[]> {
  const levels = await p.evaluate(() =>
    Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? '').trim().slice(0, 60) })),
  );
  const out: string[] = [];
  const h1 = levels.filter((h) => h.level === 1).length;
  if (h1 !== 1) out.push(`${h1} titre(s) h1`);
  for (let i = 1; i < levels.length; i++) {
    const prev = levels[i - 1]!;
    const cur = levels[i]!;
    if (cur.level > prev.level + 1) out.push(`h${prev.level} « ${prev.text} » suivi de h${cur.level} « ${cur.text} »`);
  }
  return out;
}

test('audit axe (WCAG 2.1 AA) : aucune violation grave, connecté et déconnecté', async ({ browser }) => {
  const anon = await newContext(browser);
  const login = await anon.newPage();
  await login.goto('/connexion');
  await expect(login.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  expect(await axeViolations(login), '/connexion').toEqual([]);
  expect(await headingProblems(login), '/connexion').toEqual([]);
  await anon.close();

  // Un examen en cours, pour auditer l'écran de passage.
  const res = await page.request.post('/api/v1/attempts', { data: { certification: cert.code, mode: 'exam', questionCount: 3 } });
  expect(res.status()).toBe(201);
  const running = ((await res.json()) as { id: string }).id;

  const pages: { path: string; ready: () => Locator }[] = [
    { path: '/', ready: () => page.getByText('Indice de préparation') },
    { path: '/examen/nouveau?mode=exam', ready: () => page.getByRole('heading', { name: 'Nouvelle session' }) },
    { path: `/tentatives/${running}`, ready: () => page.locator('#enonce') },
    { path: `/tentatives/${examAttemptId}/resultat`, ready: () => page.getByText('Score final') },
    { path: '/historique', ready: () => page.getByRole('heading', { name: 'Historique' }) },
    { path: '/labs/subnetting', ready: () => page.getByRole('heading', { level: 1 }) },
    { path: '/labs/cli', ready: () => page.getByRole('heading', { level: 1 }) },
    { path: `/labs/cli/${LAB_SLUG}`, ready: () => page.getByText('Topologie') },
    { path: `/labs/cli/sessions/${labSessionId}`, ready: () => page.getByRole('heading', { name: 'Solution' }) },
    { path: '/challenges', ready: () => page.getByRole('heading', { level: 1 }) },
    { path: `/challenges/${troubleshootChallenge(cert.code).slug}`, ready: () => page.getByText('Topologie') },
    { path: `/challenges/sessions/${challengeSessionId}`, ready: () => page.getByRole('heading', { name: 'Solution' }) },
    { path: '/revision', ready: () => page.getByRole('heading', { level: 1 }) },
    { path: `/revision/sessions/${revisionSessionId}`, ready: () => page.getByRole('heading', { level: 1 }) },
  ];
  const problems: string[] = [];
  for (const { path, ready } of pages) {
    await page.goto(path);
    await expect(ready().first()).toBeVisible();
    // Les animations d'entrée (jauge, barres) sont terminées avant l'audit des contrastes.
    await page.waitForTimeout(400);
    for (const v of await axeViolations(page)) problems.push(`${path}\n${v}`);
    for (const h of await headingProblems(page)) problems.push(`${path} : titres : ${h}`);
  }
  // Un lab en cours : le terminal et sa saisie.
  await page.goto(`/labs/cli/${LAB_SLUG}`);
  await page.getByRole('button', { name: /Démarrer le lab|Nouvelle session/ }).click();
  await expect(page.getByRole('textbox', { name: /Commande pour R1/ })).toBeVisible();
  for (const v of await axeViolations(page)) problems.push(`lab en cours\n${v}`);
  expect(problems).toEqual([]);
});
