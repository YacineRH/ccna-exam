import { listCertificationCodes, listLabCertificationCodes, loadCertification, loadExamSeries, loadLabs } from '@examforge/content';
import type { Db } from './client.js';
import { syncExamSeries, syncQuestions, upsertCertification, upsertLab } from '../services/content-sync.js';

/**
 * Importe toutes les certifications du paquet de contenu : configuration, banque, labs et série d'examens
 * figés. Idempotent : un second import du même contenu n'écrit rien, ne crée ni doublon ni nouvel examen,
 * et un examen déjà passé ne change jamais de contenu (voir `syncExamSeries`).
 */
export async function seedContent(db: Db, log: (msg: string) => void = () => {}): Promise<void> {
  for (const code of listCertificationCodes()) {
    const { certification, questions } = loadCertification(code);
    const certId = await upsertCertification(db, certification);
    const q = await syncQuestions(db, certId, questions);
    log(`${code} : ${questions.length} questions (${q.created} nouvelles, ${q.updated} mises à jour)`);
    if (listLabCertificationCodes().includes(code)) {
      const { labs } = loadLabs(code);
      for (const lab of labs) await upsertLab(db, certId, lab, { source: 'import' });
      log(`${code} : ${labs.length} labs`);
    }
    const series = loadExamSeries(code);
    if (series) {
      const s = await syncExamSeries(db, certId, series);
      log(
        `${code} : ${series.exams.length} examens blancs (${s.created} créés, ${s.updated} mis à jour, ${s.unchanged} inchangés` +
          (s.frozen.length ? `, ${s.frozen.length} déjà passés gardés tels quels : n° ${s.frozen.join(', ')})` : ')'),
      );
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { createDb } = await import('./client.js');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquant');
  const { db, pool } = createDb(url);
  await seedContent(db, console.log);
  await pool.end();
}
