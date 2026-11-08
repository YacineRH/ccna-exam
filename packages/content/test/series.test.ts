import { describe, expect, it } from 'vitest';
import {
  allocateByWeight,
  assembleSeries,
  checkSeries,
  DIFFICULTIES,
  DUPLICATE_THRESHOLD,
  findNearDuplicates,
  seriesReport,
  type Question,
} from '@examforge/core';
import { loadCertification, loadExamSeries, poolOf } from '../src/index.js';

/*
 * Cibles du bloc 6 (docs/ARCHITECTURE.md, « Banque complète et série de 100 examens blancs ») :
 * banque CCNA, mélange des types et des difficultés, série de 100 examens figés et ses contraintes.
 */

const { certification, questions } = loadCertification('ccna');
const count = (pred: (q: Question) => boolean) => questions.filter(pred).length;

describe('banque CCNA : cibles chiffrées', () => {
  it('compte au moins 1 500 questions publiées', () => {
    expect(questions.length).toBeGreaterThanOrEqual(1500);
  });

  it('suit les pondérations officielles à un point près', () => {
    for (const d of certification.domains) {
      const share = count((q) => q.domain === d.code) / questions.length;
      expect(Math.abs(share - d.weight), `domaine ${d.code} : ${(share * 100).toFixed(1)} %`).toBeLessThanOrEqual(0.01);
    }
  });

  it('a au moins 15 questions par sous-thème du programme', () => {
    const thin = certification.domains
      .flatMap((d) => d.subtopics.map((s) => ({ code: s.code, n: count((q) => q.subtopic === s.code) })))
      .filter((s) => s.n < 15);
    expect(thin).toEqual([]);
  });

  it('a les six types dans chaque domaine (au moins 5 de chacun), sauf la CLI en 6.0', () => {
    const missing: string[] = [];
    for (const d of certification.domains) {
      for (const t of certification.allowedQuestionTypes) {
        if (t === 'cli' && d.code === '6.0') continue;
        const n = count((q) => q.domain === d.code && q.body.type === t);
        if (n < 5) missing.push(`${d.code} ${t} : ${n}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('dose les difficultés à 30/50/20 sur la banque (3 points) et par domaine (5 points)', () => {
    const target = { easy: 0.3, medium: 0.5, hard: 0.2 };
    for (const diff of DIFFICULTIES) {
      expect(Math.abs(count((q) => q.difficulty === diff) / questions.length - target[diff]), diff).toBeLessThanOrEqual(0.03);
      for (const d of certification.domains) {
        const inDomain = count((q) => q.domain === d.code);
        const share = count((q) => q.domain === d.code && q.difficulty === diff) / inDomain;
        expect(Math.abs(share - target[diff]), `${d.code} ${diff}`).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it('ne contient aucun quasi-doublon au-dessus du seuil', () => {
    const pairs = findNearDuplicates(
      questions.map((q) => ({ id: q.slug, body: q.body, key: q.key })),
      { threshold: DUPLICATE_THRESHOLD },
    );
    expect(pairs.map((p) => `${p.a} ~ ${p.b} (${p.score})`)).toEqual([]);
  });

  it('garde la source de chaque question générée en lot', () => {
    // Les questions du bloc 6 sont rédigées par une IA puis relues : elles portent `source: "ai"`.
    expect(count((q) => q.source === 'ai')).toBeGreaterThanOrEqual(1500 - 222);
  });
});

describe('série de 100 examens blancs figés', () => {
  const series = loadExamSeries('ccna');
  const exams = series?.exams.map((e) => e.questions) ?? [];
  const pool = poolOf(questions);
  const report = seriesReport(exams, pool, certification);

  it('existe, avec 100 examens numérotés au format officiel', () => {
    expect(series).not.toBeNull();
    expect(series!.exams.map((e) => e.number)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(series!.constraints).toEqual({ maxUses: 8, maxOverlap: 12 });
    const plan = allocateByWeight(certification.domains, certification.examFormat.questionCount);
    for (const exam of exams) expect(exam).toHaveLength([...plan.values()].reduce((s, n) => s + n, 0));
  });

  it('respecte les pondérations, sans doublon, avec N = 8 et 12 questions communes au plus', () => {
    expect(checkSeries(exams, pool, certification, series!.constraints)).toEqual([]);
    expect(report.uses.max).toBeLessThanOrEqual(8);
    expect(report.overlap.max).toBeLessThanOrEqual(12);
  });

  it('sert chaque question publiée au moins une fois', () => {
    expect(report.uses.unused).toEqual([]);
    expect(report.uses.min).toBeGreaterThanOrEqual(1);
  });

  it('équilibre chaque examen : difficultés à 5 points de 30/50/20, au moins 45 sous-thèmes sur 53', () => {
    const q = certification.examFormat.questionCount;
    for (const r of report.exams) {
      expect(Math.abs(r.byDifficulty.easy / q - 0.3), `examen ${r.number}`).toBeLessThanOrEqual(0.05);
      expect(Math.abs(r.byDifficulty.medium / q - 0.5), `examen ${r.number}`).toBeLessThanOrEqual(0.05);
      expect(Math.abs(r.byDifficulty.hard / q - 0.2), `examen ${r.number}`).toBeLessThanOrEqual(0.05);
      expect(r.subtopicsCovered, `examen ${r.number}`).toBeGreaterThanOrEqual(45);
    }
  });

  it('est exactement ce que l’assembleur produit avec ce seed et cette banque (rejouable)', () => {
    const again = assembleSeries(pool, certification, { seed: series!.seed, examCount: 100, ...series!.constraints });
    expect(again.exams).toEqual(exams);
  });
});
