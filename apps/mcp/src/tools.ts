import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DIFFICULTIES, QUESTION_TYPES, type CertificationConfig } from '@examforge/core';
import { ApiError, type ApiClient } from './api-client.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

/** Une erreur d'API devient un résultat lisible par l'IA, pour qu'elle corrige et réessaie. */
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return text(await fn());
  } catch (err) {
    if (err instanceof ApiError) {
      return { ...text({ error: err.code, message: err.message, details: err.details }), isError: true };
    }
    throw err;
  }
}

interface CertificationDetail {
  certification: CertificationConfig;
  bank: { questions: number; byDomain: Record<string, number>; exams: number };
}

/** Exemple de forme attendue par type, donné à l'IA dans la consigne de génération. */
const SHAPES: Record<(typeof QUESTION_TYPES)[number], { body: unknown; key: unknown }> = {
  mcq_single: {
    body: { type: 'mcq_single', stem: '…', exhibit: '(optionnel) sortie de commande', options: [{ id: 'a', text: '…' }, { id: 'b', text: '…' }, { id: 'c', text: '…' }, { id: 'd', text: '…' }] },
    key: { type: 'mcq_single', correct: 'b' },
  },
  mcq_multi: {
    body: { type: 'mcq_multi', stem: '… (Choisissez deux réponses.)', selectCount: 2, options: [{ id: 'a', text: '…' }, { id: 'b', text: '…' }, { id: 'c', text: '…' }, { id: 'd', text: '…' }, { id: 'e', text: '…' }] },
    key: { type: 'mcq_multi', correct: ['a', 'd'] },
  },
  fill_blank: {
    body: { type: 'fill_blank', stem: '…', fields: [{ id: 'network', label: 'Adresse réseau' }] },
    key: { type: 'fill_blank', fields: { network: { accepted: ['10.0.0.0'], normalize: 'ipv4' } } },
  },
  cli: {
    body: { type: 'cli', stem: '…', prompt: 'R1(config-if)#', lines: 2 },
    key: { type: 'cli', ordered: true, commands: [['ip address 10.0.0.1 255.255.255.0'], ['no shutdown']] },
  },
  ordering: {
    body: { type: 'ordering', stem: '…', items: [{ id: 'x', text: '…' }, { id: 'y', text: '…' }, { id: 'z', text: '…' }] },
    key: { type: 'ordering', order: ['x', 'y', 'z'] },
  },
  matching: {
    body: { type: 'matching', stem: '…', left: [{ id: 'l1', text: '…' }, { id: 'l2', text: '…' }], right: [{ id: 'r1', text: '…' }, { id: 'r2', text: '…' }] },
    key: { type: 'matching', pairs: { l1: 'r2', l2: 'r1' } },
  },
};

export function createExamForgeServer(api: ApiClient): McpServer {
  const server = new McpServer(
    { name: 'exam-forge-mcp', version: '0.1.0' },
    {
      instructions:
        "Outils de production de contenu ExamForge. Cycle d'une question : generate_question (consigne) -> " +
        'rédiger la question -> submit_question (validation automatique) -> validate_question (seconde passe de relecture) -> ' +
        'record_review (publie ou renvoie en brouillon). Seules les questions publiées entrent dans les examens. ' +
        "generate_exam assemble un examen blanc figé à partir des questions publiées et indique quoi générer s'il en manque.",
    },
  );

  server.registerTool(
    'get_certification',
    {
      title: 'Certification et état de la banque',
      description: 'Configuration d\'une certification (domaines, pondérations, sous-thèmes, barème, format) et nombre de questions publiées par domaine.',
      inputSchema: { certification: z.string().describe('Code, ex. "ccna"') },
    },
    async ({ certification }) => run(() => api.get(`/certifications/${encodeURIComponent(certification)}`)),
  );

  server.registerTool(
    'generate_question',
    {
      title: 'Consigne de génération d\'une question',
      description:
        "Prépare la génération d'une question atomique : renvoie le format exact attendu, les règles de qualité et les énoncés déjà présents sur ce sous-thème (à ne pas dupliquer). Rédigez ensuite la question et envoyez-la avec submit_question.",
      inputSchema: {
        certification: z.string(),
        domain: z.string().describe('Code du domaine, ex. "3.0"'),
        subtopic: z.string().optional().describe('Code du sous-thème, ex. "3.4"'),
        type: z.enum(QUESTION_TYPES),
        difficulty: z.enum(DIFFICULTIES),
      },
    },
    async ({ certification, domain, subtopic, type, difficulty }) =>
      run(async () => {
        const detail = await api.get<CertificationDetail>(`/certifications/${encodeURIComponent(certification)}`);
        const cert = detail.certification;
        const dom = cert.domains.find((d) => d.code === domain);
        if (!dom) throw new ApiError(400, 'unknown_domain', `Domaine ${domain} inconnu`, cert.domains.map((d) => d.code));
        const sub = subtopic ? dom.subtopics.find((s) => s.code === subtopic) : undefined;
        if (subtopic && !sub) throw new ApiError(400, 'unknown_subtopic', `Sous-thème ${subtopic} inconnu`, dom.subtopics.map((s) => s.code));
        if (!cert.allowedQuestionTypes.includes(type)) throw new ApiError(400, 'type_not_allowed', `Type ${type} non autorisé`, cert.allowedQuestionTypes);

        const query = new URLSearchParams({ certification, domain, limit: '500', ...(subtopic ? { subtopic } : {}) });
        const existing = await api.get<{ questions: { slug: string; stem: string }[] }>(`/admin/questions?${query}`);
        const slugBase = `${certification}-${subtopic ?? domain}-`;
        const used = existing.questions.filter((q) => q.slug.startsWith(slugBase)).length;

        return {
          target: {
            certification: `${cert.name} (${cert.examCode})`,
            domain: `${dom.code} ${dom.name} (${Math.round(dom.weight * 100)} % de l'examen)`,
            subtopic: sub ? `${sub.code} ${sub.name}` : null,
            type,
            difficulty,
          },
          format: {
            slug: `${slugBase}<sujet-court>-${String(used + 1).padStart(3, '0')} (minuscules, chiffres, points et tirets)`,
            certification,
            domain,
            ...(subtopic ? { subtopic } : {}),
            difficulty,
            ...SHAPES[type],
            explanation: 'Pourquoi la bonne réponse est juste (20 caractères minimum).',
            distractorNotes: { '<id option fausse>': 'Pourquoi ce distracteur est faux.' },
            reference: '(optionnel) RFC, guide de configuration…',
          },
          rules: [
            "Exactitude technique non négociable : la bonne réponse doit être vraie dans la version de l'examen visée.",
            "Distracteurs plausibles mais faux sans ambiguïté, de longueur et de style comparables à la bonne réponse.",
            'Une note dans distractorNotes pour chaque option fausse.',
            "Pas de « toutes les réponses » ni de « aucune réponse ». Pas d'indice grammatical vers la bonne réponse.",
            "L'ordre des options est mélangé à l'affichage : ne pas s'appuyer sur la position.",
            'CLI : une ligne par commande attendue, formes complètes (les abréviations IOS sont acceptées automatiquement).',
            'Rédaction en français ; noms de commandes, protocoles et sorties IOS dans leur forme réelle.',
            'Ne pas reprendre un énoncé existant ci-dessous, même reformulé.',
          ],
          existingStems: existing.questions.map((q) => ({ slug: q.slug, stem: q.stem })),
          next: 'Envoyez la question complète avec submit_question.',
        };
      }),
  );

  server.registerTool(
    'submit_question',
    {
      title: 'Soumettre une question',
      description:
        "Soumet une question rédigée. L'API vérifie le schéma, la cohérence de la correction (ids, nombre de réponses…), le rangement (domaine, sous-thème, type autorisé) et l'absence de doublon. Si elle est acceptée, elle passe à l'état « validated » et doit être relue avec validate_question.",
      inputSchema: {
        question: z.record(z.unknown()).describe('Question complète au format donné par generate_question'),
      },
    },
    async ({ question }) =>
      run(async () => {
        const res = await api.post<{ slug: string; status: string }>('/admin/questions', { question, source: 'ai' });
        return { ...res, next: `Lancez validate_question avec slug "${res.slug}" pour la seconde passe.` };
      }),
  );

  server.registerTool(
    'validate_question',
    {
      title: 'Relecture d\'une question (seconde passe)',
      description:
        'Renvoie la question complète avec sa correction et une grille de relecture. Vérifiez chaque point de façon indépendante, puis appelez record_review pour publier ou renvoyer en brouillon.',
      inputSchema: { slug: z.string() },
    },
    async ({ slug }) =>
      run(async () => ({
        question: await api.get(`/admin/questions/${encodeURIComponent(slug)}`),
        checklist: [
          'La bonne réponse est-elle techniquement exacte (valeurs par défaut, syntaxe IOS, numéros de RFC) ?',
          'Chaque distracteur est-il faux sans ambiguïté, y compris dans un cas limite ?',
          "L'énoncé contient-il toutes les informations nécessaires, et seulement celles-là ?",
          "Le niveau de difficulté annoncé est-il réaliste pour l'examen ?",
          "L'explication justifie-t-elle la réponse et chaque note de distracteur est-elle exacte ?",
          'Pour une question CLI : les commandes attendues fonctionnent-elles dans le mode indiqué par le prompt ?',
        ],
        next: 'Appelez record_review(slug, approved, issues).',
      })),
  );

  server.registerTool(
    'record_review',
    {
      title: 'Enregistrer la relecture',
      description: 'Publie la question (approved=true) ou la renvoie en brouillon avec la liste des problèmes trouvés.',
      inputSchema: {
        slug: z.string(),
        approved: z.boolean(),
        issues: z.array(z.string()).default([]).describe('Problèmes relevés, obligatoires si approved=false'),
      },
    },
    async ({ slug, approved, issues }) =>
      run(() => api.post(`/admin/questions/${encodeURIComponent(slug)}/review`, { approved, issues })),
  );

  server.registerTool(
    'generate_exam',
    {
      title: 'Générer un examen blanc',
      description:
        "Assemble un examen blanc figé et numéroté à partir des questions publiées : pondération officielle des domaines, aucune question en double, priorité aux questions encore jamais utilisées dans un autre examen. S'il manque des questions, indique combien en générer et dans quel domaine.",
      inputSchema: {
        certification: z.string(),
        question_count: z.number().int().min(1).max(200).optional().describe('Par défaut, le format officiel'),
        difficulty: z.enum(DIFFICULTIES).optional(),
        target_domains: z.array(z.string()).optional(),
      },
    },
    async ({ certification, question_count, difficulty, target_domains }) =>
      run(async () => {
        try {
          return await api.post('/admin/exams', {
            certification,
            ...(question_count ? { questionCount: question_count } : {}),
            ...(difficulty ? { difficulty } : {}),
            ...(target_domains?.length ? { domains: target_domains } : {}),
          });
        } catch (err) {
          if (err instanceof ApiError && err.code === 'insufficient_questions') {
            const d = err.details as { domain: string; needed: number; available: number };
            throw new ApiError(err.status, err.code, err.message, {
              ...d,
              todo: `Générez et publiez au moins ${d.needed - d.available} question(s) de plus dans le domaine ${d.domain}, puis relancez generate_exam.`,
            });
          }
          throw err;
        }
      }),
  );

  server.registerTool(
    'analyze_weakness',
    {
      title: 'Analyser les points faibles',
      description:
        "Analyse l'historique de l'utilisateur sur une certification : niveau de préparation, maîtrise par domaine et sous-thèmes à retravailler en priorité.",
      inputSchema: { certification: z.string() },
    },
    async ({ certification }) =>
      run(async () => {
        const stats = await api.get<{
          readiness: unknown;
          passingScore: number;
          domains: { code: string; name: string; weight: number; answered: number; percent: number | null }[];
          toReview: { domain: string; subtopic: string | null; subtopicName: string | null; errors: number; answered: number }[];
        }>(`/stats?certification=${encodeURIComponent(certification)}`);
        // Priorité = poids du domaine x écart à 100 % : un domaine lourd et mal maîtrisé passe devant.
        const domains = stats.domains
          .map((d) => ({ ...d, priority: d.percent === null ? d.weight : Math.round(d.weight * (100 - d.percent) * 10) / 10 }))
          .sort((a, b) => b.priority - a.priority);
        return {
          readiness: stats.readiness,
          passingScore: stats.passingScore,
          domainsByPriority: domains,
          subtopicsToReview: stats.toReview,
        };
      }),
  );

  server.registerTool(
    'add_certification',
    {
      title: 'Déclarer une certification',
      description:
        "Ajoute ou met à jour une certification sans toucher au code : domaines (pondérations dont la somme vaut 1), sous-thèmes, barème, format d'examen, types de questions autorisés.",
      inputSchema: {
        config: z
          .object({
            code: z.string(),
            name: z.string(),
            vendor: z.string(),
            examCode: z.string(),
            domains: z.array(
              z.object({
                code: z.string(),
                name: z.string(),
                weight: z.number(),
                subtopics: z.array(z.object({ code: z.string(), name: z.string() })).optional(),
              }),
            ),
            scoring: z.object({ min: z.number(), max: z.number(), passing: z.number() }),
            examFormat: z.object({ questionCount: z.number(), durationMinutes: z.number(), allowBackNavigation: z.boolean() }),
            allowedQuestionTypes: z.array(z.enum(QUESTION_TYPES)),
          })
          .describe('Configuration complète de la certification'),
      },
    },
    async ({ config }) => run(() => api.post('/admin/certifications', { config })),
  );

  return server;
}
