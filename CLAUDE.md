# ExamForge — notes pour les sessions Claude

Plateforme d'entraînement aux certifications (premier produit : CCNA 200-301). Cahier des charges : `CAHIER_DES_CHARGES.md`. Architecture : `docs/ARCHITECTURE.md`.

## Règles du projet

- Le moteur est générique : rien de propre au CCNA dans `packages/core`, `apps/api` ou `apps/web`. Le CCNA vit dans `packages/content/data/`.
- La correction (`answer_key`) ne doit jamais être envoyée au navigateur avant la soumission d'un examen. Les tests API le vérifient.
- Le serveur MCP passe toujours par l'API, jamais par la base.
- Interface et contenus en français. Design « NOC Console » validé (fond nuit, accent cyan #2DD4E8, IBM Plex Sans/Mono, Space Grotesk pour les titres) : maquettes sur https://claude.ai/artifact/7wgvibe4Z3as9RiTuF4Frk.
- Exactitude technique des questions non négociable : chaque question a une explication et une note par distracteur.

## Commandes

```sh
pnpm install && pnpm build        # le build de core/content est nécessaire avant les tests des autres paquets
pnpm typecheck
TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test pnpm test
pnpm --filter @examforge/api db:generate   # après une modification de apps/api/src/db/schema.ts
```

PostgreSQL local dans un conteneur de session : `pg_ctlcluster 16 main start`, puis créer le rôle `examforge` (mot de passe `examforge`) et les bases `examforge` et `examforge_test`.

## Déploiement

VPS OVH, à côté d'Hydre mais isolé (`docker-compose.yml`, port 127.0.0.1:8080 derrière le reverse proxy existant). Voir `docs/DEPLOIEMENT.md`.
