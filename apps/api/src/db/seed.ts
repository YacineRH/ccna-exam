import { listCertificationCodes, listLabCertificationCodes, loadCertification, loadLabs } from '@examforge/content';
import type { Db } from './client.js';
import { upsertCertification, upsertLab, upsertQuestion } from '../services/content-sync.js';

/** Importe toutes les certifications du paquet de contenu. Idempotent : on peut le relancer. */
export async function seedContent(db: Db, log: (msg: string) => void = () => {}): Promise<void> {
  for (const code of listCertificationCodes()) {
    const { certification, questions } = loadCertification(code);
    const certId = await upsertCertification(db, certification);
    let created = 0;
    for (const q of questions) {
      const r = await upsertQuestion(db, certId, q, { source: q.source ?? 'import' });
      if (r.created) created++;
    }
    log(`${code} : ${questions.length} questions (${created} nouvelles)`);
    if (listLabCertificationCodes().includes(code)) {
      const { labs } = loadLabs(code);
      for (const lab of labs) await upsertLab(db, certId, lab, { source: 'import' });
      log(`${code} : ${labs.length} labs`);
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
