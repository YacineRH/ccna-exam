import { loadCertification, loadLabs } from '@examforge/content';
import { allocateByWeight, type Lab, type Question } from '@examforge/core';

/*
 * Les tests ne codent en dur aucune question : ils lisent la banque du dépôt (packages/content),
 * celle que l'API importe au démarrage, pour retrouver la correction d'une question affichée.
 */

const cache = new Map<string, Question[]>();

export function bankOf(code: string): Question[] {
  let questions = cache.get(code);
  if (!questions) {
    questions = loadCertification(code).questions;
    cache.set(code, questions);
  }
  return questions;
}

/** Retrouve une question par son énoncé (texte du paragraphe #enonce). */
export function questionByStem(code: string, shownStem: string): Question {
  const stem = shownStem.replace(/\s*\(Choisissez \d+ réponses\.\)\s*$/, '').trim();
  const found = bankOf(code).find((q) => q.body.stem.trim() === stem);
  if (!found) throw new Error(`Question introuvable dans la banque ${code} : « ${stem.slice(0, 80)} »`);
  return found;
}

const isMcq = (q: Question) => q.body.type === 'mcq_single' || q.body.type === 'mcq_multi';

/**
 * Examen court : le plus petit domaine qui compte au moins deux QCM, et 6 questions au plus.
 * Le tirage est aléatoire dans ce domaine ; les QCM y sont largement majoritaires.
 */
export function shortExamPlan(code: string, max = 6): { domain: string; count: number } {
  const byDomain = new Map<string, Question[]>();
  for (const q of bankOf(code)) byDomain.set(q.domain, [...(byDomain.get(q.domain) ?? []), q]);
  const plans = [...byDomain.entries()]
    .map(([domain, qs]) => ({ domain, size: qs.length, mcq: qs.filter(isMcq).length }))
    .filter((p) => p.mcq >= 2)
    .sort((a, b) => a.size - b.size || a.domain.localeCompare(b.domain));
  const plan = plans[0];
  if (!plan) throw new Error(`Aucun domaine de ${code} ne compte deux QCM`);
  return { domain: plan.domain, count: Math.min(max, plan.size) };
}

/**
 * Nombre maximal de questions tirables avec un filtre de types, calculé indépendamment de
 * l'interface : domaines sans question de ces types écartés, puis répartition au plus fort reste.
 */
export function maxDrawableForTypes(code: string, types: readonly string[]): number {
  const { certification } = loadCertification(code);
  const counts = new Map<string, number>();
  for (const q of bankOf(code)) if (types.includes(q.body.type)) counts.set(q.domain, (counts.get(q.domain) ?? 0) + 1);
  const domains = certification.domains.filter((d) => (counts.get(d.code) ?? 0) > 0);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  for (let n = Math.min(200, total); n >= 1; n--) {
    const plan = allocateByWeight(domains, n);
    if (domains.every((d) => (plan.get(d.code) ?? 0) <= (counts.get(d.code) ?? 0))) return n;
  }
  return 0;
}

export function certificationOf(code: string) {
  return loadCertification(code).certification;
}

/** Un lab du dépôt, par son slug. */
export function labOf(code: string, slug: string): Lab {
  const lab = loadLabs(code).labs.find((l) => l.slug === slug);
  if (!lab) throw new Error(`Lab introuvable : ${slug}`);
  return lab;
}
