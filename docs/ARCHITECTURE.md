# Architecture

ExamForge est un moteur générique de certification. Le CCNA 200-301 est sa première configuration, pas une partie du code.

## Vue d'ensemble

```
             navigateur                         client MCP (Claude…)
                 │ HTTPS                               │ stdio
   ┌─────────────▼──────────────┐            ┌─────────▼─────────┐
   │ reverse proxy du VPS (TLS)  │            │  exam-forge-mcp   │
   └─────────────┬──────────────┘            │    apps/mcp        │
                 │ 127.0.0.1:8080             └─────────┬─────────┘
   ┌─────────────▼──────────────┐                      │ HTTPS + jeton de service
   │ web : Caddy + SPA React     │──── /api/* ───┐      │
   │ apps/web                    │               │      │
   └─────────────────────────────┘     ┌─────────▼──────▼──┐
                                        │ api : Fastify      │
                                        │ apps/api           │
                                        └─────────┬─────────┘
                                                  │
                                        ┌─────────▼─────────┐
                                        │ PostgreSQL 16      │
                                        └───────────────────┘
```

| Dossier | Rôle |
| --- | --- |
| `packages/core` | Moteur pur, sans I/O : schémas de certification et de question, correction des 6 types de questions, normalisation des commandes IOS, assemblage pondéré des examens, notation, niveau de préparation, outils IPv4 et subnetting. Utilisé par l'API, le MCP et le navigateur. |
| `packages/content` | Le contenu en données : `data/certifications/<code>.json` et `data/questions/<code>/*.json`. Chargé et validé au démarrage de l'API. |
| `apps/api` | API REST versionnée (`/api/v1`) : comptes, tentatives, statistiques, administration. Seul composant qui écrit en base. |
| `apps/web` | Interface React (Vite, Tailwind) avec le design « NOC Console ». |
| `apps/mcp` | Serveur MCP `exam-forge-mcp`, client de l'API. |

## Principes

- **Une certification est une donnée.** `certificationSchema` (packages/core) décrit domaines, pondérations, sous-thèmes, barème, format d'examen et types de questions autorisés. Ajouter Security+ = un fichier JSON ou un appel à `add_certification`.
- **La correction ne quitte jamais le serveur avant la soumission.** Une question est stockée en deux parties : `body` (public) et `answer_key` (privé). Pendant un examen, l'API n'envoie que `body`, avec l'ordre des options mélangé par tentative.
- **Pas de doublon, garanti à deux niveaux.** Dans un examen, la clé primaire `(exam_id, question_id)` l'interdit. Dans la banque, chaque question a une empreinte d'énoncé normalisé, unique par certification.
- **Le MCP passe par l'API.** Il s'authentifie avec un jeton de service et subit exactement les mêmes validations qu'un humain.
- **Le temps est vérifié côté serveur.** L'échéance est stockée à la création de la tentative ; une réponse arrivée après l'échéance (plus 30 s de tolérance) déclenche la soumission.

## Modèle de données

```
certifications ─┬─< domains ─< subtopics
                ├─< questions (body, answer_key, content_hash, status)
                ├─< exams ─< exam_questions >─ questions
                └─< attempts ─< attempt_answers >─ questions
users ─< attempts
```

- `questions.status` : `draft` → `validated` (validation automatique) → `published` (relecture). Seules les questions publiées entrent dans les examens et les tirages.
- `exams` : les examens blancs figés et numérotés (l'examen n°12 a toujours les mêmes questions).
- `attempts` : une session d'examen ou d'entraînement, avec seed, échéance, position la plus avancée (pour interdire le retour arrière), score au barème et score par domaine.
- `attempt_answers` : réponse, temps passé, marquage « à revoir », résultat.

Les migrations SQL sont générées par Drizzle dans `apps/api/drizzle/` et appliquées au démarrage de l'API.

## Notation

- Chaque type de question est noté en tout ou rien pour l'examen, avec une part de réussite (`partial`) conservée pour l'entraînement. En QCM multiple, cocher plus de cases que demandé vaut zéro.
- Le score d'un examen est la moyenne des taux de réussite par domaine, pondérée par le poids officiel, ramenée au barème de la certification (300–1000 pour Cisco).
- Le seuil de 825 du CCNA est **simulé** : Cisco ne publie pas de seuil officiel.
- Le niveau de préparation est la moyenne des 5 derniers examens blancs, les plus récents pesant davantage.

## Questions CLI

`normalizeCommand` ramène une commande à une forme canonique : casse, espaces, abréviations non ambiguës (`conf t`, `sh ip int br`), noms d'interface (`Gi0/0` = `GigabitEthernet0/0`) et ports nommés (`eq www` = `eq 80`). Comme dans IOS, un préfixe ambigu n'est pas développé et ne correspond donc pas.

## Sécurité

- Mots de passe hachés en argon2id (paramètres OWASP). Le temps de réponse ne révèle pas si un e-mail existe.
- Session JWT dans un cookie `httpOnly`, `SameSite=Strict`, `Secure` en production.
- Connexion et inscription limitées à 5 essais par minute et par IP ; 300 requêtes par minute pour le reste.
- Toute entrée est validée par zod côté serveur. Le corps des requêtes est limité à 256 Ko.
- En-têtes de sécurité et CSP stricte servis par Caddy.
- Secrets uniquement en variables d'environnement (`.env` ignoré par git, secrets GitHub pour la CI).
- Détection basique de triche : un examen complet bouclé à moins de 5 s par question est marqué `suspicious`.
