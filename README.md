# ExamForge

Plateforme d'entraînement aux certifications IT. Premier produit : un simulateur d'examen **CCNA 200-301** fidèle aux conditions réelles (chrono, pas de retour arrière, notation au barème Cisco), avec un tableau de bord de progression et un serveur MCP qui permet à une IA de produire examens et questions.

Le moteur ne contient rien de propre au CCNA : une certification est une configuration (domaines, pondérations, barème, format). Ajouter Security+ ou AWS est une opération de contenu.

## Fonctionnalités

- Examens blancs chronométrés, tirés selon la pondération officielle des 6 domaines, sans doublon.
- Entraînement libre par domaine, avec correction immédiate et explication des distracteurs.
- 6 types de questions : QCM simple et multiple, champs à compléter (subnetting), commandes IOS (abréviations acceptées), remise en ordre, association.
- Tableau de bord : niveau de préparation face au seuil, maîtrise par domaine, courbe de progression, sous-thèmes à revoir.
- Trainer de subnetting à exercices infinis.
- Serveur MCP `exam-forge-mcp` : génération et double relecture des questions, assemblage d'examens, analyse des points faibles.

## Stack

TypeScript partout, monorepo pnpm.

| Couche | Technologies |
| --- | --- |
| Moteur | `packages/core`, pur TypeScript + zod |
| API | Fastify 5, Drizzle ORM, PostgreSQL 16, argon2id, JWT en cookie httpOnly |
| Front | React 18, Vite, Tailwind CSS |
| MCP | `@modelcontextprotocol/sdk` (stdio) |
| Infra | Docker Compose, Caddy, GitHub Actions, VPS OVH |

## Démarrer en local

Prérequis : Node 22, pnpm 10, PostgreSQL 16.

```sh
pnpm install
pnpm build
createdb examforge   # ou une base Docker : docker run -e POSTGRES_PASSWORD=... -p 5432:5432 postgres:16
export DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge
export JWT_SECRET=$(openssl rand -base64 48)
pnpm dev:api   # http://localhost:3000, migrations et contenu appliqués au démarrage
pnpm dev:web   # http://localhost:5173
```

Le premier compte créé devient administrateur.

## Tests

```sh
pnpm typecheck
TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test pnpm test
```

Les tests de l'API tournent sur une vraie base PostgreSQL (vidée à chaque lancement) ; sans `TEST_DATABASE_URL`, ils sont ignorés. La CI GitHub Actions lance tout, avec PostgreSQL, à chaque push.

## Documentation

- [Architecture et modèle de données](docs/ARCHITECTURE.md)
- [Déploiement sur le VPS OVH](docs/DEPLOIEMENT.md)
- [Serveur MCP](docs/MCP.md)
- [Cahier des charges](CAHIER_DES_CHARGES.md)

## Ajouter du contenu

- Une question : un objet JSON dans `packages/content/data/questions/<certification>/`. `pnpm --filter @examforge/content test` vérifie le schéma, la cohérence de la correction, les doublons, et qu'une bonne réponse obtient bien tous les points.
- Une certification : un fichier dans `packages/content/data/certifications/`, ou l'outil MCP `add_certification`.

## Feuille de route

- [x] Phase 0 : socle (schéma, API, auth, CI, déploiement)
- [x] Phase 1 : moteur d'examen (passage, notation, historique)
- [x] Phase 2 : tableau de bord (préparation, domaines, à revoir)
- [x] Phase 3 : serveur MCP (génération et validation)
- [ ] Remplir la banque : ~100 examens blancs générés via le MCP
- [ ] Phase 4 : CLI trainer IOS, challenges chronométrés, flashcards à répétition espacée
- [ ] Phase 5 : finitions, accessibilité, mobile
- [ ] Phase 6 : deuxième certification (Security+)
