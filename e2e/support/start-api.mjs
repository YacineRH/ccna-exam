// Démarre l'API buildée (apps/api/dist) sur une base de test remise à zéro.
// Lancé par Playwright (webServer) : `pnpm build` doit avoir été exécuté avant.
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const url =
  process.env.E2E_DATABASE_URL ??
  process.env.TEST_DATABASE_URL ??
  'postgres://examforge:examforge@localhost:5432/examforge_test';

// Garde-fou : la base est vidée, on refuse tout ce qui ne ressemble pas à une base de test.
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!/test/i.test(dbName)) {
  console.error(`[e2e] refus de vider la base « ${dbName} » : son nom doit contenir « test ».`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
await client.end();

Object.assign(process.env, {
  NODE_ENV: 'test', // journaux coupés, cookie sans « Secure » (HTTP local)
  DATABASE_URL: url,
  HOST: '127.0.0.1',
  PORT: process.env.E2E_API_PORT ?? '3100',
  JWT_SECRET: randomBytes(32).toString('hex'),
  ALLOW_REGISTRATION: 'false',
  // Le balayage de toute la banque enchaîne des centaines d'enregistrements par minute.
  ...(process.env.E2E_RATE_LIMIT_MAX ? { RATE_LIMIT_MAX: process.env.E2E_RATE_LIMIT_MAX } : {}),
});

// Migrations, contenu du dépôt, puis écoute : comme en production.
await import('../../apps/api/dist/server.js');
