import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { seedContent } from './db/seed.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);

// Au démarrage : schéma à jour, puis contenu du dépôt importé (opération idempotente).
await runMigrations(db);
const app = await buildApp(env, db);
await seedContent(db, (msg) => app.log.info(msg));

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ host: env.HOST, port: env.PORT });
