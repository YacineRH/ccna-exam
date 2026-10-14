import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './client.js';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

// Exécution directe : `pnpm db:migrate`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { createDb } = await import('./client.js');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquant');
  const { db, pool } = createDb(url);
  await runMigrations(db);
  await pool.end();
  console.log('Migrations appliquées.');
}
