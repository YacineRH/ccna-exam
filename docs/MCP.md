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

Un lab suit donc le même cycle qu'une question : `generate_lab` → rédaction → `submit_lab` → `validate_lab` → `record_lab_review`. Seuls les labs publiés apparaissent dans `/labs/cli`.

`generate_challenge` (mini-défis chronométrés) reste à faire.

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

> Pour le CCNA, appelle `list_labs` : pour un sous-thème sans lab, appelle `generate_lab`, rédige un lab avec uniquement les commandes listées, soumets-le avec `submit_lab` et corrige-le jusqu'à ce qu'il passe le simulateur. Relis-le avec `validate_lab` de façon critique, puis publie-le ou rejette-le avec `record_lab_review`.
