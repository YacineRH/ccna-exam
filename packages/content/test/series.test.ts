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
import { listBankTargetCodes, loadBankTargets, loadCertification, loadExamSeries, poolOf } from '../src/index.js';

/*
 * Cibles chiffrées de la banque et de la série, paramétrées par certification : `data/bank-targets/<code>.json`
 * donne les chiffres, les tests sont les mêmes pour toutes (docs/ARCHITECTURE.md, « Cibles de la banque »).
 */

describe('cibles de banque', () => {
  it('chaque certification qui a une banque a ses cibles', () => {
    expect(listBankTargetCodes()).toEqual(expect.arrayContaining(['ccna', 'security-plus']));
  });
});

describe.each(listBankTargetCodes())('banque %s : cibles chiffrées', (code) => {
  const targets = loadBankTargets(code)!;
  const { certification, questions } = loadCertification(code);
  const count = (pred: (q: Question) => boolean) => questions.filter(pred).length;
  const { bank } = targets;

  it(`compte au moins ${bank.minQuestions} questions publiées`, () => {
    expect(questions.length).toBeGreaterThanOrEqual(bank.minQuestions);
  });

  it(`suit les pondérations officielles à ${bank.weightTolerance * 100} point(s) près`, () => {
    for (const d of certification.domains) {
      const share = count((q) => q.domain === d.code) / questions.length;
      expect(Math.abs(share - d.weight), `domaine ${d.code} : ${(share * 100).toFixed(1)} %`).toBeLessThanOrEqual(bank.weightTolerance);
    }
  });

  it(`a au moins ${bank.minPerSubtopic} questions par sous-thème du programme`, () => {
    const thin = certification.domains
      .flatMap((d) => d.subtopics.map((s) => ({ code: s.code, n: count((q) => q.subtopic === s.code) })))
      .filter((s) => s.n < bank.minPerSubtopic);
    expect(thin).toEqual([]);
    expect(questions.every((q) => q.subtopic !== undefined)).toBe(true);
  });

  it(`a chaque type autorisé dans chaque domaine (au moins ${bank.minPerDomainType} de chacun, hors exceptions déclarées)`, () => {
    const missing: string[] = [];
    for (const d of certification.domains) {
      for (const t of certification.allowedQuestionTypes) {
        if (bank.domainTypeExemptions.some((e) => e.domain === d.code && e.type === t)) continue;
        const n = count((q) => q.domain === d.code && q.body.type === t);
        if (n < bank.minPerDomainType) missing.push(`${d.code} ${t} : ${n}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('ne contient aucune question d’un type que la certification n’autorise pas', () => {
    expect(questions.filter((q) => !certification.allowedQuestionTypes.includes(q.body.type)).map((q) => q.slug)).toEqual([]);
  });

  it('dose les types : QCM multiples en proportion, QCM simples majoritaires', () => {
    expect(count((q) => q.body.type === 'mcq_multi') / questions.length).toBeGreaterThanOrEqual(bank.minMultiShare);
    expect(count((q) => q.body.type === 'mcq_single')).toBeGreaterThan(count((q) => q.body.type === 'mcq_multi'));
  });

  it('dose les difficultés sur la banque et par domaine', () => {
    const { bankTolerance, domainTolerance } = bank.difficulty;
    for (const diff of DIFFICULTIES) {
      const target = bank.difficulty[diff];
      expect(Math.abs(count((q) => q.difficulty === diff) / questions.length - target), `banque ${diff}`).toBeLessThanOrEqual(bankTolerance);
      for (const d of certification.domains) {
        const inDomain = count((q) => q.domain === d.code);
        const share = count((q) => q.domain === d.code && q.difficulty === diff) / inDomain;
        expect(Math.abs(share - target), `${d.code} ${diff}`).toBeLessThanOrEqual(domainTolerance);
      }
    }
  });

  it('cite une référence pour chaque question, explique chaque question', () => {
    expect(questions.filter((q) => !q.reference?.trim()).map((q) => q.slug)).toEqual([]);
    expect(questions.filter((q) => q.explanation.trim().length < 100).map((q) => q.slug)).toEqual([]);
  });

  it('ne contient aucun quasi-doublon au-dessus du seuil', () => {
    const pairs = findNearDuplicates(
      questions.map((q) => ({ id: q.slug, body: q.body, key: q.key })),
      { threshold: DUPLICATE_THRESHOLD },
    );
    expect(pairs.map((p) => `${p.a} ~ ${p.b} (${p.score})`)).toEqual([]);
  });

  it('garde la source de chaque question générée en lot', () => {
    expect(count((q) => q.source === 'ai')).toBeGreaterThanOrEqual(bank.minAiSource);
  });
});

describe.each(listBankTargetCodes())('série %s : examens blancs figés', (code) => {
  const { series: target } = loadBankTargets(code)!;
  const { certification, questions } = loadCertification(code);
  const series = loadExamSeries(code);
  const exams = series?.exams.map((e) => e.questions) ?? [];
  const pool = poolOf(questions);
  const report = seriesReport(exams, pool, certification);
  const officialSize = [...allocateByWeight(certification.domains, certification.examFormat.questionCount).values()].reduce((s, n) => s + n, 0);

  it(`existe, avec ${target.exams} examens numérotés au format officiel`, () => {
    expect(series).not.toBeNull();
    expect(series!.exams.map((e) => e.number)).toEqual(Array.from({ length: target.exams }, (_, i) => i + 1));
    expect(series!.constraints).toEqual({ maxUses: target.maxUses, maxOverlap: target.maxOverlap });
    expect(officialSize).toBe(certification.examFormat.questionCount);
    for (const exam of exams) expect(exam).toHaveLength(certification.examFormat.questionCount);
  });

  it(`respecte les pondérations, sans doublon, avec N = ${target.maxUses} et ${target.maxOverlap} questions communes au plus`, () => {
    expect(checkSeries(exams, pool, certification, series!.constraints)).toEqual([]);
    expect(report.uses.max).toBeLessThanOrEqual(target.maxUses);
    expect(report.overlap.max).toBeLessThanOrEqual(target.maxOverlap);
  });

  it('sert chaque question publiée au moins une fois', () => {
    expect(report.uses.unused).toEqual([]);
    expect(report.uses.min).toBeGreaterThanOrEqual(1);
  });

  it('équilibre chaque examen : difficultés et sous-thèmes couverts', () => {
    const size = certification.examFormat.questionCount;
    const bankTargets = loadBankTargets(code)!.bank.difficulty;
    for (const r of report.exams) {
      for (const diff of DIFFICULTIES) {
        expect(Math.abs(r.byDifficulty[diff] / size - bankTargets[diff]), `examen ${r.number} ${diff}`).toBeLessThanOrEqual(target.difficultyTolerance);
      }
      expect(r.subtopicsCovered, `examen ${r.number}`).toBeGreaterThanOrEqual(target.minSubtopicsPerExam);
    }
  });

  it('est exactement ce que l’assembleur produit avec ce seed et cette banque (rejouable)', () => {
    const again = assembleSeries(pool, certification, { seed: series!.seed, examCount: target.exams, ...series!.constraints });
    expect(again.exams).toEqual(exams);
  });
});
