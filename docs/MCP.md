# Serveur MCP `exam-forge-mcp`

Il permet à une IA (Claude ou tout client MCP) de produire du contenu sans retouche manuelle. Il ne touche jamais la base : il appelle l'API avec un jeton de service, et chaque question passe donc par la même validation qu'une question écrite à la main.

## Outils

| Outil | Rôle |
| --- | --- |
| `get_certification` | Configuration d'une certification et nombre de questions publiées par domaine. |
| `generate_question` | Consigne de génération : format exact attendu, règles de qualité, énoncés existants à ne pas dupliquer, slug suggéré. |
| `submit_question` | Validation automatique : schéma, cohérence de la correction, rangement, doublons. La question passe à l'état `validated`. |
| `validate_question` | Seconde passe : renvoie la question avec sa correction et une grille de relecture. |
| `record_review` | Publie la question, ou la renvoie en brouillon avec les problèmes relevés. |
| `generate_exam` | Assemble un examen blanc figé et numéroté (pondération officielle, aucun doublon, priorité aux questions jamais utilisées). S'il manque des questions, dit combien générer et dans quel domaine. |
| `analyze_weakness` | Niveau de préparation, domaines triés par priorité (poids × lacune) et sous-thèmes à revoir. |
| `add_certification` | Déclare ou met à jour une certification par simple configuration. |
| `list_labs` | Labs CLI d'une certification (slug, titre, difficulté, sous-thème, statut) et nombre de labs publiés par sous-thème. |
| `generate_lab` | Consigne de génération d'un lab : format exact, types d'objectifs, commandes que le simulateur connaît (par mode et type d'équipement), règles de qualité, labs existants du sous-thème, slug suggéré. |
| `submit_lab` | Validation automatique : schéma, rangement, puis l'API joue le lab dans le simulateur (état de départ, solution, variantes, pièges). Le lab passe à l'état `validated`. |
| `validate_lab` | Seconde passe : renvoie le lab complet, solution comprise, avec une grille de relecture (commandes, modes, valeurs par défaut, calculs, variantes acceptées). |
| `record_lab_review` | Publie le lab, ou le renvoie en brouillon avec les problèmes relevés. |
| `generate_challenge` | `generate_challenge(certification, theme, duree_cible, mode?, subtopic?, difficulty?)` : consigne d'un challenge chronométré, au format d'un lab avec `kind: "challenge"`, sans indice, et le bloc `challenge` (temps cible = `duree_cible`, échéance proposée, mode `build` ou `troubleshoot`, pannes semées). Règles du dépannage, commandes du simulateur, challenges existants, sous-thèmes si aucun n'est donné. |

Un lab suit donc le même cycle qu'une question : `generate_lab` → rédaction → `submit_lab` → `validate_lab` → `record_lab_review`. Seuls les labs publiés apparaissent dans `/labs/cli`.

Un challenge suit le même cycle : `generate_challenge` → rédaction → `submit_lab` (joué dans le simulateur : configuration de départ avec ses pannes, solution, variantes, pièges) → `validate_lab` → `record_lab_review`. Seuls les challenges publiés apparaissent dans `/challenges`.

## Génération en lots (banque complète)

Pour remplir une banque d'un coup (bloc 6 : 1 308 questions CCNA en 43 lots), on ne passe pas question par question par l'API : les lots sont rédigés et relus hors ligne, puis versionnés dans `packages/content/data/`, que l'API importe au démarrage (voir `docs/DEPLOIEMENT.md`). Le format et les règles sont exactement ceux de `generate_question` ; les contrôles sont ceux de `submit_question`, plus la détection des quasi-doublons.

1. **Plan** : cibles par domaine, sous-thème, type et difficulté (`docs/ARCHITECTURE.md`), découpées en lots de 20 à 40 questions d'un ou deux sous-thèmes. Chaque lot a un brief : sous-thèmes, nombre exact de questions par type et par difficulté, angles du programme à couvrir. Deux lots d'un même sous-thème ont des angles disjoints et ne tournent pas en même temps : le second voit le premier dans la banque.
2. **Rédaction** par un agent, avec `docs/generation/consigne-redaction.md` et le brief. Il lit l'existant (`pnpm --filter @examforge/content batch:context <sous-thème> --full`) et contrôle son lot jusqu'à zéro erreur (`batch:check <lot> --subtopics …` : schéma, correction cohérente, bonne réponse qui obtient tous les points, note par distracteur, référence, source `ai`, slug unique, doublon exact, quasi-doublon au-delà de 0,70 face à la banque et dans le lot).
3. **Relecture** par un second agent qui n'a vu ni la rédaction ni ses échanges, avec `docs/generation/consigne-relecture.md` : exactitude IOS / CCNA 200-301, bonne réponse unique, distracteurs faux sans ambiguïté, explication et notes justes, pas d'indice grammatical, calculs refaits. Il corrige (en distinguant fond et forme) ou rejette, écrit le lot relu et un journal (une entrée par question), et relance `batch:check`.
4. **Publication** du seul lot relu : `pnpm --filter @examforge/content batch:merge <lot relu> <fichier>` (contrôle puis copie dans `data/questions/<code>/`), puis `pnpm --filter @examforge/content test`. Un commit par domaine.
5. **Contrôle d'échantillon** : une troisième passe relit 5 % des questions publiées, tirées au hasard dans chaque lot. Au-delà de 2 % d'erreurs dans l'échantillon d'un lot, tout le lot est relu de nouveau.
6. **Série** : `pnpm --filter @examforge/content series:build` assemble les 100 examens figés (`data/exams/<code>.json`) et affiche le rapport ; `series:check` vérifie que le fichier est à jour. `near-duplicates` liste les paires suspectes de toute la banque pour la relecture.

Le journal des relectures du bloc 6 est résumé dans `docs/generation/journal-bloc-6.md`. Une banque déjà en production se complète de la même façon : les nouvelles questions arrivent au déploiement suivant, et la série n'est régénérée que si l'on accepte qu'elle change pour les examens jamais commencés (ceux déjà passés ne bougent pas).

## Pourquoi la génération se fait côté client

Le serveur ne contient pas de clé d'API d'IA : c'est le modèle qui appelle les outils qui rédige les questions. `generate_question` lui donne un cadre strict, puis `submit_question` et `validate_question` assurent le contrôle qualité en deux passes. Aucun secret d'IA n'est donc stocké sur le serveur, et n'importe quel client MCP peut produire du contenu.

## Branchement

Construire le serveur :

```sh
pnpm install && pnpm build
```

**Claude Code**

```sh
claude mcp add exam-forge \
  --env EXAMFORGE_API_URL=https://ccna.yratech.fr \
  --env EXAMFORGE_SERVICE_TOKEN=<valeur de SERVICE_TOKEN dans le .env du VPS> \
  -- node /chemin/vers/ccna-exam/apps/mcp/dist/server.js
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "exam-forge": {
      "command": "node",
      "args": ["/chemin/vers/ccna-exam/apps/mcp/dist/server.js"],
      "env": {
        "EXAMFORGE_API_URL": "https://ccna.yratech.fr",
        "EXAMFORGE_SERVICE_TOKEN": "<SERVICE_TOKEN>"
      }
    }
  }
}
```

Le jeton de service agit au nom du premier compte administrateur. Il se change dans le `.env` du VPS, suivi de `docker compose up -d`.

## Exemple de consigne pour remplir la banque

> Pour le CCNA, appelle `get_certification` pour voir la banque. Pour chaque domaine sous-représenté, génère 10 questions variées (types et difficultés mélangés) avec `generate_question`, soumets-les, relis chacune avec `validate_question` de façon critique, puis publie-les ou rejette-les avec `record_review`. Termine par `generate_exam`.

> Pour le CCNA, appelle `generate_challenge` avec le thème « dépannage OSPF entre deux routeurs » et une durée cible de 8 minutes, rédige un challenge de dépannage (pannes réalistes dans la configuration de départ, objectifs qui décrivent le service rétabli), soumets-le avec `submit_lab` jusqu'à ce qu'il passe le simulateur, relis-le avec `validate_lab` en cherchant un moyen de gagner sans vraiment corriger, puis publie-le ou rejette-le avec `record_lab_review`.

> Pour le CCNA, appelle `list_labs` : pour un sous-thème sans lab, appelle `generate_lab`, rédige un lab avec uniquement les commandes listées, soumets-le avec `submit_lab` et corrige-le jusqu'à ce qu'il passe le simulateur. Relis-le avec `validate_lab` de façon critique, puis publie-le ou rejette-le avec `record_lab_review`.
