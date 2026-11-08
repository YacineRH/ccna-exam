# Consigne de rédaction d'un lot de questions

Cette consigne est donnée telle quelle à l'agent qui rédige un lot (20 à 40 questions d'un ou deux sous-thèmes). Elle reprend le format et les règles de l'outil MCP `generate_question` ; le lot reçoit en plus son brief (sous-thèmes, nombre de questions par type et par difficulté, angles à couvrir, fichier de sortie).

## 1. Préparer

1. Lire le brief du lot (fichier `lots/<id>.json` indiqué dans la demande).
2. Lister les questions déjà présentes sur les sous-thèmes du lot, **à ne pas dupliquer, même reformulées** :
   `node packages/content/scripts/batch-context.mjs <sous-thème> [<sous-thème>…] --full`
3. Regarder deux ou trois questions existantes de chaque type dans `packages/content/data/questions/ccna/` pour le ton et le format.

## 2. Format

Le fichier de sortie est un **tableau JSON** de questions. Chaque question :

```json
{
  "slug": "ccna-3.4-ospf-dead-timer-002",
  "certification": "ccna",
  "domain": "3.0",
  "subtopic": "3.4",
  "difficulty": "medium",
  "source": "ai",
  "body": { "type": "…", "stem": "…", "exhibit": "… (facultatif)", "…": "selon le type" },
  "key": { "type": "…", "…": "selon le type" },
  "explanation": "Pourquoi la bonne réponse est juste, avec le raisonnement complet (300 à 700 caractères en général).",
  "distractorNotes": { "<id d'option fausse>": "Pourquoi ce distracteur est faux." },
  "reference": "RFC 2328, section 10.5"
}
```

- **slug** : `ccna-<sous-thème>-<sujet-court>-<NNN>`, minuscules, chiffres, points et tirets ; sujet court descriptif et propre à la question ; `NNN` = `001`, ou le numéro suivant si le sujet existe déjà. Unique dans toute la banque (le contrôle le vérifie).
- **source** : toujours `"ai"`.
- **reference** : obligatoire. RFC, norme IEEE, guide de configuration ou note technique Cisco. Un numéro de section seulement si l'on en est sûr ; sinon, la norme ou le guide sans section (jamais de référence inventée).
- **exhibit** : sortie de commande, extrait de configuration ou topologie en texte. Sorties IOS réalistes et cohérentes avec l'énoncé (mêmes adresses, mêmes noms). Lignes de 80 caractères au plus. L'énoncé commence alors par « Reportez-vous à l'exhibit. ».

### Les six types

| Type | `body` | `key` | Règles |
| --- | --- | --- | --- |
| `mcq_single` | `options: [{id, text}]` (exactement 4) | `correct: "<id>"` | Une seule réponse juste. |
| `mcq_multi` | `options` (5, ou 6 pour trois réponses), `selectCount` | `correct: ["<id>", …]` | L'énoncé annonce le nombre : « Quelles deux … ? » ou « (Choisissez-en deux.) ». |
| `fill_blank` | `fields: [{id, label}]` | `fields: {<id>: {accepted: [...], normalize: "ipv4" \| "int" \| "text"}}` | Le libellé précise le format attendu (« en décimal pointé », « sans le / », « nombre entier »). `ipv4` pour une adresse ou un masque, `int` pour un nombre, `text` sinon (casse et espaces ignorés) : lister toutes les écritures acceptables. Pour une adresse IPv6, demander une forme précise (« forme compressée la plus courte ») et l'accepter. |
| `cli` | `prompt` (ex. `R1(config)#`), `lines` | `commands: [[formes acceptées de la ligne 1], …]`, `ordered`, `freeOrder` | Une ligne par commande, formes **complètes** (les abréviations IOS, la casse et les noms d'interface courts sont acceptés automatiquement). Lister les formes équivalentes (mot-clé facultatif, valeur par défaut explicite). `ordered: true` avec `freeOrder: [[1, 2]]` pour des sous-commandes d'interface dont l'ordre est libre ; `ordered: false` si tout ordre convient. L'énoncé donne toutes les valeurs et part du mode du prompt. |
| `ordering` | `items: [{id, text}]` (4 à 6) | `order: [ids dans l'ordre]` | Un seul ordre juste, sans ambiguïté. |
| `matching` | `left`, `right` (4 à 5 à gauche ; 0 à 2 leurres à droite) | `pairs: {<id gauche>: <id droite>}` | Chaque leurre de droite a sa note dans `distractorNotes` (clé = id de droite). Plusieurs éléments de gauche peuvent viser le même élément de droite (classement par catégorie). |

## 3. Règles de qualité (non négociables)

1. **Exactitude technique** : la bonne réponse est vraie pour le CCNA 200-301 (v1.1) et IOS / IOS XE actuels. Valeurs par défaut, syntaxe, numéros de port et de RFC vérifiés. Au moindre doute, choisir une autre question.
2. **Une seule bonne réponse**, vraie dans tous les cas raisonnables. Les distracteurs sont **faux sans ambiguïté**, y compris dans un cas limite ou une autre version d'IOS, tout en restant plausibles (erreurs typiques de candidat).
3. **Valeurs calculées vérifiées deux fois** (subnetting, wildcards, coûts OSPF et STP, EUI-64, priorités, timers…), par exemple avec `python3 -c "import ipaddress; …"`.
4. **Une note par distracteur** (`distractorNotes`), juste et précise ; une explication qui justifie la réponse et apprend quelque chose.
5. **Aucun indice** : pas d'accord grammatical qui trahit la bonne option (genre, nombre, élision), pas de mot de l'énoncé repris seulement dans la bonne option, bonne réponse ni systématiquement la plus longue ni la plus précise ; options de forme parallèle. Pas de « toutes les réponses », « aucune réponse » ni « A et B ».
6. **Énoncé autonome** : toutes les informations nécessaires, et seulement elles ; jamais de référence à une autre question.
7. **Pas de doublon** : ni avec la banque (sortie de `batch-context.mjs`), ni dans le lot. Deux questions du même gabarit doivent porter sur d'autres valeurs **et** une autre réponse, ou sur un autre aspect.
8. **Rédaction en français**, guillemets « », commandes, protocoles et sorties IOS dans leur forme réelle (en anglais).
9. **Difficulté** :
   - `easy` : rappel d'un fait ou d'une définition (port, valeur par défaut, rôle) ;
   - `medium` : application ou compréhension (lire un exhibit simple, choisir une commande, un calcul en une étape) ;
   - `hard` : analyse en plusieurs étapes (diagnostic sur exhibit, VLSM, élection STP ou DR à calculer, combinaison de conditions).
10. **Répartition** : respecter exactement le nombre de questions par type et par difficulté du brief, et couvrir tous les angles listés (plusieurs questions par angle). Varier l'identifiant de la bonne option (pas toujours `a`).

## 4. Contrôler

```sh
node packages/content/scripts/check-batch.mjs <fichier du lot> --subtopics <codes séparés par des virgules>
```

Corriger jusqu'à « OK : aucune erreur ». Lire les avertissements : une paire **suspecte** doit être reformulée pour porter sur un autre aspect ou d'autres valeurs (ou la question remplacée) ; un mot CLI sans abréviation reconnue est acceptable s'il est écrit en entier dans toutes les formes.

## 5. Rendre

Ne pas recopier les questions dans la réponse. Rendre en 10 lignes au plus : chemin du fichier, nombre de questions par type et par difficulté, résultat du contrôle, points d'attention éventuels.
