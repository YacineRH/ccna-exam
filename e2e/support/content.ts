import { loadCertification } from '@examforge/content';
import type { Question } from '@examforge/core';

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
 * Domaine pour un examen court déterministe : le plus petit domaine qui compte au moins
 * deux QCM. En tirant autant de questions qu'il en contient, l'examen les prend toutes.
 */
export function shortExamPlan(code: string): { domain: string; count: number; mcq: number } {
  const byDomain = new Map<string, Question[]>();
  for (const q of bankOf(code)) byDomain.set(q.domain, [...(byDomain.get(q.domain) ?? []), q]);
  const plans = [...byDomain.entries()]
    .map(([domain, qs]) => ({ domain, count: qs.length, mcq: qs.filter(isMcq).length }))
    .filter((p) => p.mcq >= 2)
    .sort((a, b) => a.count - b.count || a.domain.localeCompare(b.domain));
  const plan = plans[0];
  if (!plan) throw new Error(`Aucun domaine de ${code} ne compte deux QCM`);
  return plan;
}
