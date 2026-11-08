# ExamForge

Plateforme d'entraînement aux certifications IT. Premier produit : un simulateur d'examen **CCNA 200-301** fidèle aux conditions réelles (chrono, pas de retour arrière, notation au barème Cisco), avec un tableau de bord de progression et un serveur MCP qui permet à une IA de produire examens et questions.

Le moteur ne contient rien de propre au CCNA : une certification est une configuration (domaines, pondérations, barème, format). Ajouter Security+ ou AWS est une opération de contenu.

## Fonctionnalités

- Série de 100 examens blancs figés et numérotés (102 questions, pondération officielle, deux examens ont au plus 12 questions en commun), avec la progression dans la série et le meilleur score par examen ; ou un tirage pondéré à la demande.
- Entraînement libre par domaine et par type de question, avec correction immédiate et explication des distracteurs.
- Révision en un clic d'un sous-thème raté, depuis la carte « À revoir » du tableau de bord.
- 6 types de questions : QCM simple et multiple, champs à compléter (subnetting), commandes IOS (abréviations acceptées), remise en ordre, association.
- Tableau de bord : niveau de préparation face au seuil, maîtrise par domaine, courbe de progression, sous-thèmes à revoir.
- Banque CCNA de 1 530 questions relues (rédaction et relecture séparées, contrôle d'échantillon), au moins 15 par sous-thème, réparties selon les pondérations officielles, sans quasi-doublon.
- Trainer de subnetting à exercices infinis.
- Trainer CLI IOS : 13 labs CCNA sur un routeur ou un commutateur simulé (modes, prompts, abréviations, erreurs et aide `?` comme sur IOS), objectifs vérifiés en direct, trois indices, solution et explication à la fin, meilleur temps et historique.
- Challenges chronométrés : 11 défis CCNA sans indice (7 de dépannage, des pannes à trouver dans la configuration de départ), échéance contrôlée par le serveur, fin automatique, meilleur temps et courbe des temps.
- Révision espacée : flashcards par sous-thème tirées de la banque (Leitner, intervalles de 1 à 64 jours), écran « À réviser aujourd'hui », correction immédiate.
- Accessible (WCAG 2.1 AA, audit axe en CI) et utilisable sur mobile (terminal avec barre d'actions tactile).
- Serveur MCP `exam-forge-mcp` : génération et double relecture des questions, des labs CLI et des challenges, assemblage d'examens, analyse des points faibles.

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

Les tests de l'API tournent sur une vraie base PostgreSQL (vidée à chaque lancement) ; sans `TEST_DATABASE_URL`, ils sont ignorés.

### Tests navigateur (Playwright)

Le paquet `e2e/` démarre l'API buildée sur une base de test **vidée au démarrage** (son nom doit contenir « test ») et le front buildé (`vite preview`), puis rejoue dans Chromium : inscription et tableau de bord vide, sélecteur de certification, entraînement « ordre » au clavier, entraînement « association », entraînement filtré par type lancé depuis l'écran de lancement, examen court (chrono, marquage, soumission, mêmes lettres d'options dans les résultats), « Réviser » depuis le tableau de bord après un examen raté, examen blanc complet (toutes les questions, chrono officiel, soumis sans tout répondre), lab CLI résolu au clavier (abréviations, erreur IOS, aide, indice, collage, Ctrl+Z, écran de fin, lab marqué fait et présent dans l'historique), challenge de dépannage résolu au clavier puis classement mis à jour, challenge expiré (fin automatique), session de révision (cartes dues, réponses, échéances recalculées), absence de débordement et zones de 44 px à 390 px, mise en page à 360, 390, 768 et 1280 px (terminal mobile compris), et audit axe-core de toutes les pages.

`pnpm e2e:browsers` joue un test de fumée (connexion, examen court, lab) dans Chromium, Firefox et WebKit ; Firefox et WebKit ne sont pas préinstallés dans les conteneurs de session, la CI les installe (job non bloquant). `pnpm bundle:check` vérifie le budget du bundle initial après `pnpm build`.

`pnpm e2e:sweep` affiche en plus chaque question de la banque à 390 px (pendant la tentative et dans le post-mortem). Il est long : la CI le lance dans un job séparé, non bloquant.

```sh
pnpm build
pnpm --filter @examforge/e2e exec playwright install chromium   # une fois
E2E_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test pnpm e2e
```

Sans `E2E_DATABASE_URL`, la suite prend `TEST_DATABASE_URL`, puis la base `examforge_test` locale. Ports utilisés : 3100 (API) et 4180 (front).

La CI GitHub Actions lance tout, avec PostgreSQL, à chaque push : build, typecheck, tests unitaires et API, suite e2e, images Docker.

## Documentation

- [Architecture et modèle de données](docs/ARCHITECTURE.md)
- [Déploiement sur le VPS OVH](docs/DEPLOIEMENT.md)
- [Serveur MCP](docs/MCP.md)
- [Cahier des charges](CAHIER_DES_CHARGES.md)

## Ajouter du contenu

- Une question : un objet JSON dans `packages/content/data/questions/<certification>/`. `pnpm --filter @examforge/content test` vérifie le schéma, la cohérence de la correction, les doublons, et qu'une bonne réponse obtient bien tous les points.
- Une certification : un fichier dans `packages/content/data/certifications/`, ou l'outil MCP `add_certification`.
- Un lab CLI : un fichier JSON dans `packages/content/data/labs/<certification>/` (format dans `docs/ARCHITECTURE.md`), ou les outils MCP `generate_lab` puis `submit_lab`. Un challenge : même format avec `kind: "challenge"`, dans `packages/content/data/labs/<certification>/challenges/`, ou `generate_challenge` puis `submit_lab`. `pnpm --filter @examforge/content test` joue chaque lab : sa solution et ses variantes doivent réussir, ses pièges échouer.

## Feuille de route

- [x] Phase 0 : socle (schéma, API, auth, CI, déploiement)
- [x] Phase 1 : moteur d'examen (passage, notation, historique)
- [x] Phase 2 : tableau de bord (préparation, domaines, à revoir)
- [x] Phase 3 : serveur MCP (génération et validation)
- [x] Bloc 1 : corrections v0.1 (mêmes lettres d'options dans les résultats, certification choisie dans l'en-tête, chrono corrigé du décalage d'horloge, filtre par type de question, tests navigateur Playwright en CI)
- [x] Bloc 2 : banque complète et entraînement ciblé (banque CCNA portée à plus de 210 questions relues, deux examens complets sans doublon ; filtre `subtopics` ; compteurs de la banque par type et sous-thème ; choix des types en entraînement ; bouton « Réviser » ; chrono recalé à chaque réponse)
- [x] Bloc 3 : trainer CLI IOS (simulateur de terminal générique, profil IOS en données, 13 labs CCNA relus, routes `/labs` et `/lab-attempts`, écran `/labs/cli`, labs dans le tableau de bord et l'historique, outils MCP `list_labs` et `generate_lab`) ; chrono d'examen recalé toutes les 5 min ; balayage à 390 px de toute la banque (`pnpm e2e:sweep`)
- [x] Bloc 4 : challenges chronométrés et révision espacée (fidélité du simulateur : ordre de `show running-config`, EtherChannel, VTY 0 4 / 5 15, ACL numérotées en mode nommé, HSRP, ports TCP/UDP ; 11 challenges CCNA relus, dont 7 de dépannage ; échéance serveur, classement personnel ; flashcards Leitner ; `generate_challenge`)
- [x] Bloc 5 : finitions, accessibilité (audit axe WCAG 2.1 AA en CI, titres, zones de 44 px, mouvement réduit), mobile (terminal tactile, 360 à 1280 px, fumée Firefox et WebKit), performance (découpage par route, budget du bundle, polices auto-hébergées, Lighthouse ≥ 90)
- [x] Bloc 6 : banque complète et 100 examens blancs (banque CCNA portée à 1 530 questions en 43 lots rédigés puis relus par des agents distincts, contrôle d'échantillon ; assembleur de série déterministe et détection des quasi-doublons dans `packages/core` ; 100 examens figés importés au démarrage, idempotents, jamais modifiés une fois passés ; écran de lancement par numéro et progression dans la série)
- [ ] Phase 6 : deuxième certification (Security+)
