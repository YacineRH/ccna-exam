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
| `packages/core` | Moteur pur, sans I/O : schémas de certification et de question, correction des 6 types de questions, normalisation des commandes IOS, assemblage pondéré des examens, notation, niveau de préparation, outils IPv4 et subnetting, simulateur de terminal et format des labs (`src/terminal/`). Utilisé par l'API, le MCP et le navigateur. |
| `packages/content` | Le contenu en données : `data/certifications/<code>.json`, `data/questions/<code>/*.json`, et pour les labs `data/labs/<code>/profile.json` (profil de terminal) et `data/labs/<code>/*.json`. Chargé, validé et joué au démarrage de l'API. |
| `apps/api` | API REST versionnée (`/api/v1`) : comptes, tentatives, statistiques, administration. Seul composant qui écrit en base. |
| `apps/web` | Interface React (Vite, Tailwind) avec le design « NOC Console ». |
| `apps/mcp` | Serveur MCP `exam-forge-mcp`, client de l'API. |
| `e2e` | Tests de bout en bout Playwright : API buildée sur une base de test vidée, front buildé servi par `vite preview`. |

## Principes

- **Une certification est une donnée.** `certificationSchema` (packages/core) décrit domaines, pondérations, sous-thèmes, barème, format d'examen et types de questions autorisés. Ajouter Security+ = un fichier JSON ou un appel à `add_certification`.
- **La solution d'un lab ne quitte jamais le serveur avant la fin.** Même règle que `answer_key` : avant `POST /lab-attempts/:id/finish`, l'API n'envoie que l'énoncé, la topologie, la description des objectifs (jamais leur contrôle), les indices déjà demandés et les sorties des commandes saisies. Solution, variantes, explication et référence n'apparaissent que dans `result`, une fois la session terminée. Les tests de l'API le vérifient sur toutes les réponses d'une session.
- **La correction ne quitte jamais le serveur avant la soumission.** Une question est stockée en deux parties : `body` (public) et `answer_key` (privé). Pendant un examen, l'API n'envoie que `body`, avec l'ordre des options mélangé par tentative. Le post-mortem (`/result`) applique le même mélange, avec le même seed : les lettres A, B, C sont celles que le candidat a vues. La correction référence des identifiants d'options, elle ne dépend pas de l'ordre.
- **Pas de doublon, garanti à deux niveaux.** Dans un examen, la clé primaire `(exam_id, question_id)` l'interdit. Dans la banque, chaque question a une empreinte d'énoncé normalisé, unique par certification.
- **Le MCP passe par l'API.** Il s'authentifie avec un jeton de service et subit exactement les mêmes validations qu'un humain.
- **Le temps est vérifié côté serveur.** L'échéance est stockée à la création de la tentative ; une réponse arrivée après l'échéance (plus 30 s de tolérance) déclenche la soumission.

## Tentatives : contrat de l'API

| Route | Points notables |
| --- | --- |
| `POST /attempts` | `certification`, `mode` (`exam` ou `practice`), et en option `examNumber` (examen figé), `questionCount`, `domains`, `types`, `subtopics`. |
| `GET /attempts` | Tentatives de l'utilisateur, 50 au plus ; filtre optionnel `?certification=<code>`. |
| `GET /attempts/:id` | État visible par le navigateur, jamais de correction en examen. Contient `certification` (code de la certification de la tentative) et `serverNow` (heure du serveur, ISO 8601). |
| `PUT /attempts/:id/answers/:questionId` | Enregistre réponse, marquage et temps passé. Renvoie `{ saved, serverNow }`, plus `feedback` (correction) en entraînement seulement. |
| `GET /attempts/:id/result` | Post-mortem une fois la tentative close, même ordre d'affichage que pendant la tentative. |

- **Filtre `types`** : liste de types de questions (`mcq_single`, `mcq_multi`, `fill_blank`, `cli`, `ordering`, `matching`), combinée avec `allowedQuestionTypes` de la certification : il ne peut que restreindre. Les domaines qui n'ont aucune question des types demandés sont écartés et les pondérations des autres renormalisées, pour qu'un type rare reste utilisable en entraînement ciblé. Si aucun domaine ne convient, l'API répond `409 insufficient_questions` avec `domain: "*"`. Sans effet sur un examen figé (`examNumber`). Implémenté dans `assembleExam` (`packages/core/src/assembly.ts`).
- **Filtre `subtopics`** : liste de codes de sous-thèmes, sur le modèle de `types` et combinable avec lui. Une question sans sous-thème est écartée, les domaines sans question retenue aussi, et les pondérations des autres sont renormalisées. Un code inconnu ou sans question donne `409 insufficient_questions` avec `domain: "*"`. Les codes de sous-thèmes sont uniques dans une certification (vérifié par `certificationSchema`). C'est ce filtre qu'utilise le bouton « Réviser » de la carte « À revoir » : 10 questions du sous-thème en entraînement, ou toutes s'il en a moins.
- **`GET /attempts/:id/clock`** : `{ status, deadlineAt, serverNow }`, sans les questions. Le chrono d'examen s'en sert pour un recalage léger toutes les 5 minutes et au retour sur l'onglet (`scheduleClockResync`), en plus du recalage à chaque enregistrement.
- **`serverNow` et le chrono** : le navigateur estime le décalage entre son horloge et celle du serveur en comparant `serverNow` au milieu de l'aller-retour de la requête, puis décompte en heure serveur (`apps/web/src/lib/clock.ts`). La mesure est faite au chargement de la tentative, puis refaite à chaque enregistrement de réponse ou de marquage (`resyncOffset`) : une horloge de poste qui saute en cours d'examen (veille, NTP, changement manuel) est rattrapée au premier enregistrement suivant. Une réponse sans `serverNow` lisible garde le décalage précédent. L'échéance reste contrôlée côté serveur.
- **`certification`** : l'écran de passage et les résultats utilisent la certification de la tentative, pas celle choisie dans l'en-tête. Le tableau de bord, le lancement, les statistiques et l'historique suivent le sélecteur de l'en-tête (liste issue de `GET /certifications`, choix gardé dans `localStorage`, repli sur la première certification).

## Banque : `GET /certifications/:code`

Renvoie la configuration de la certification et les compteurs de la banque publiée (`status = published`) :

| Champ de `bank` | Contenu |
| --- | --- |
| `questions` | Total. |
| `byDomain` | Par code de domaine. |
| `byType` | Par type de question. |
| `bySubtopic` | Par code de sous-thème ; tous les sous-thèmes de la configuration y figurent, à 0 s'ils sont vides. |
| `byDomainType` | Par domaine puis par type. L'écran de lancement en déduit ce que permet un filtre de types (« la banque permet au plus N questions ») en reproduisant la logique du serveur : domaines sans question de ces types écartés, pondérations renormalisées (`apps/web/src/lib/planning.ts`). |
| `exams` | Nombre d'examens blancs figés. |

## Modèle de données

```
certifications ─┬─< domains ─< subtopics
                ├─< questions (body, answer_key, content_hash, status)
                ├─< exams ─< exam_questions >─ questions
                └─< attempts ─< attempt_answers >─ questions
users ─< attempts
certifications ─< labs ─< lab_attempts ─< lab_attempt_commands
users ─< lab_attempts
users ─< review_cards >─ questions        (révision espacée : une carte par question)
users ─< review_sessions ─< review_answers
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

## Labs CLI

### Simulateur de terminal (`packages/core/src/terminal/`)

Générique et sans I/O : il ne connaît que des modes, des commandes et des sections de configuration. Tout ce qui fait un IOS vient du **profil de terminal**, une donnée de la certification (`packages/content/data/labs/ccna/profile.json`, schéma `terminalProfileSchema`) :

- **modes** et leur prompt (`{hostname}(config-if)#`), parent (destination de `exit`), titre de l'aide, sections masquées de la configuration affichée (VLAN en VTP serveur) ;
- **messages** : `% Invalid input detected at '^' marker.` (avec le marqueur sous le mot fautif), `% Ambiguous command:  "…"`, `% Incomplete command.`, message de fin de configuration ;
- **types d'équipement** (routeur, commutateur : nom par défaut, lignes d'office sur les interfaces) et **types d'interface** (physiques, ou logiques créées à la demande) ;
- **catalogue des commandes** : syntaxe (`ip route <ipv4> <ipv4-mask> {<ipv4>|<interface>} [<1-255>]`), modes, équipements, aide `?`, et effets : entrée dans un sous-mode, changement de mode (`enable`, `configure terminal`, `exit`, `end`), variables (`hostname`), clé de remplacement (une nouvelle `ip address` remplace l'ancienne), forme `no`, listes (`switchport trunk allowed vlan add`), entrées numérotées (ACL nommées), préconditions avec leur message (domaine avant les clés RSA, port statique avant le port-security, adresse d'hôte sur une interface…), sorties.

Le moteur lit une ligne comme IOS : un mot abrégé vaut le seul mot-clé qui commence ainsi, sinon l'erreur est « ambiguous » ; une commande absente du sous-mode est cherchée dans les modes parents (`hostname` depuis une interface) ; `do` exécute une commande du mode privilégié ; Ctrl+Z (`\x1a`) et `end` reviennent au mode privilégié ; `?` liste les mots possibles, ou complète un mot commencé, sans valider la ligne ; `show running-config` (avec `| include`, `| section`) est calculé depuis l'état. Les autres `show` affichent un message « sortie non simulée ». Les noms d'interface sont reconnus en un ou deux mots (`g0/1`, `GigabitEthernet 0/1`) et doivent exister sur l'équipement. Les valeurs sont stockées sous forme canonique ; la comparaison des objectifs réutilise `normalizeCommand`.

**État d'un équipement** : mode courant, sections visées, variables, configuration courante (lignes globales et sections `interface …`, `line vty …`, `router ospf …`, `vlan …`, `ip dhcp pool …`, `ip access-list …`), historique des commandes acceptées.

#### Fidélité IOS (bloc 4)

Toujours sans rien d'IOS dans le moteur : chaque comportement est un champ du profil.

| Champ du profil | Effet | Exemple CCNA |
| --- | --- | --- |
| `rank` (commande), `rank` (type d'interface) | Ordre d'affichage de `show running-config` : lignes triées par rang, sections de même rang en ordre naturel ; interfaces logiques avant (rang négatif) ou après les physiques, qui suivent l'ordre de l'équipement. L'état garde l'ordre de saisie. | description, switchport…, ip address, shutdown ; `access-list` avant `line` ; `Port-channel1` avant `Fa0/1`, `Vlan1` après |
| `aggregate` | Agrégat : l'agrégat créé hérite des lignes du premier membre, un membre qui le rejoint reçoit les siennes, et toute modification de l'agrégat se recopie sur ses membres. | `channel-group` et `interface Port-channel` (lignes `switchport …`) |
| `blocks` | Sous-mode découpé en blocs fixes ; une plage partielle découpe un bloc, les morceaux identiques sont réunis. | `line vty 0 15` = `0 4` + `5 15` |
| `into`, `flatten` | Une commande globale exécutée dans une section ; une section affichée à plat. `no access-list N …` retire toute l'ACL, comme IOS. | `access-list 10` et `ip access-list standard 10` : la même ACL |
| `onInterfaces` | Commande limitée à des types d'interface (ailleurs : `% Invalid input`, absente de l'aide). | `clock rate` sur Serial ; `ip address` refusée sur un port L2 de 2960 |
| `rewrite` | Forme canonique réécrite puis relue. | `standby 0 ip` = `standby ip` |
| `requires[].when`, `invalidAt` | Condition gardée par la valeur d'un paramètre, refus présenté comme une saisie invalide. | groupes HSRP > 255 en version 2 seulement |
| `requires[].notInSections` | Valeur interdite si une section la porte déjà. | `ip route … <sa propre adresse>` refusée |
| `<port:tcp>`, `<port:udp>`, `portNames.{tcp,udp}` | Noms de ports par protocole. | `www` en TCP, `tftp` en UDP |
| `keyGroup` + `key` sur les formes `no` | La forme `no` est partagée par deux orthographes. | `ip domain-lookup` / `ip domain lookup` |
| `clears` | Lignes devenues inutiles effacées. | `passive-interface default` |

`TerminalDevice.complete(line)` complète le dernier mot (touche Tab d'IOS) sans rien exécuter ni enregistrer ; l'API l'expose en `POST /lab-attempts/:id/complete` pour la barre tactile du terminal.

Contrôles d'objectif ajoutés pour fermer des contournements : `sequence` avec `absent` (aucun refus avant une autorisation) et `command` avec `after` (réactiver un port après la correction, pas avant).

### Format d'un lab (`labSchema`)

| Champ | Contenu |
| --- | --- |
| `slug`, `certification`, `domain`, `subtopic`, `difficulty`, `title` | Identité et rangement (le sous-thème doit exister). |
| `statement`, `topology` | Énoncé et exhibit (schéma texte, plan d'adressage). |
| `profile`, `devices` | Profil de terminal ; équipements (type, interfaces, `startupConfig` au format de la configuration courante). |
| `objectives` | 1 à 15 objectifs : une description publique et un contrôle privé. |
| `hints` | Exactement 3 indices, du plus vague au plus précis. |
| `solution`, `variants`, `pitfalls` | Solution complète par équipement ; variantes qui doivent réussir ; pièges qui doivent échouer sur les objectifs `failing`. |
| `explanation`, `reference`, `estimatedMinutes` | Explication, référence Cisco, durée indicative. |

Contrôles d'objectif, sur l'état final (l'ordre de saisie est libre) ou sur l'historique : `line` (ligne présente ou absente, plusieurs formes), `regex` (avec `covers` pour vérifier qu'un couple adresse/masque générique couvre une adresse, `caseSensitive`), `section` (existence), `sequence` (ordre des lignes, pour les ACL), `command` (commande saisie, `afterLastChange` pour une sauvegarde qui suit la dernière modification), `all`, `any`.

`checkLab` joue chaque lab : configuration de départ acceptée, aucun objectif atteint au départ, solution et variantes sans erreur et gagnantes, pièges perdants. Les tests de contenu y ajoutent : une solution amputée d'une commande indispensable échoue, slugs uniques, sous-thèmes existants, version publique sans solution.

### API

| Route | Points notables |
| --- | --- |
| `GET /labs?certification=` | Labs publiés : titre, difficulté, sous-thème, nombre d'objectifs, durée, et pour l'utilisateur : sessions terminées, réussi ou non, meilleur temps, session en cours. |
| `GET /labs/:slug` | Énoncé, topologie, description des objectifs, nombre d'indices. Jamais la solution. |
| `POST /labs/:slug/attempts` | Démarre une session ; renvoie son état (prompt de chaque équipement). |
| `GET /lab-attempts?certification=` | Historique : temps, indices, nombre de commandes, réussite. |
| `GET /lab-attempts/:id` | État reconstitué : transcription, prompts, objectifs atteints, indices donnés ; `result` une fois terminée. |
| `POST /lab-attempts/:id/commands` | `{ device?, input }` (une ligne ou un collage multi-ligne, `\u001a` = Ctrl+Z). Exécuté côté serveur ; renvoie sortie et prompt par ligne, objectifs atteints, `complete`, `serverNow`. |
| `POST /lab-attempts/:id/hint` | Indice suivant ; le nombre d'indices est compté. `409` au-delà de 3. |
| `POST /lab-attempts/:id/finish` | Termine (réussite = tous les objectifs atteints) et révèle solution, variantes, explication, référence, commandes acceptées et configuration finale. |

Une session ne stocke que les commandes (`lab_attempt_commands`, numérotées) : l'état est reconstitué en les **rejouant dans l'ordre** depuis la configuration de départ, à chaque requête. L'envoi verrouille la session (`SELECT … FOR UPDATE`) : deux envois simultanés sont joués l'un après l'autre. Une session appartient à son utilisateur (`403` sinon). Le temps retenu va du démarrage au premier instant où tous les objectifs sont atteints. Les sessions terminées alimentent le tableau de bord : un lab réussi compte comme une réponse juste du domaine, un lab échoué comme une erreur du sous-thème dans « À revoir ».

Côté administration (MCP) : `GET /admin/lab-profile` (commandes du simulateur), `GET|POST /admin/labs`, `GET /admin/labs/:slug`, `POST /admin/labs/:slug/review`. Un lab soumis est joué dans le simulateur avant d'être accepté (`validated`), puis publié après relecture.

### Interface `/labs/cli`

Liste filtrable (sous-thème, difficulté, faits ou à faire), puis `/labs/cli/:slug` (présentation) et `/labs/cli/sessions/:id` (terminal, objectifs qui se cochent, indices, chrono optionnel recalé sur `serverNow`, écran de fin). Le terminal n'interprète rien : il envoie la saisie et affiche la réponse. Sortie en `aria-live`, historique ↑/↓, `?`, Ctrl+Z, collage multi-ligne, un onglet par équipement.

## Challenges chronométrés

Un challenge est un lab (`labSchema`) avec `kind: "challenge"`, sans indice, et un bloc `challenge` : `targetMinutes` (temps cible), `timeLimitMinutes` (échéance), `mode` (`build` : configuration à faire ; `troubleshoot` : la configuration de départ contient des pannes), `faults` (pannes semées, révélées à la fin seulement). Le moteur ne connaît que ce format, jamais le mot « CCNA ». Les fichiers vivent dans `packages/content/data/labs/<code>/challenges/` et passent par `checkLab` comme les labs (solution, variantes, pièges, aucun objectif atteint au départ) ; les tests de contenu exigent au moins 8 challenges, dont 4 de dépannage et 2 sur plusieurs équipements.

**Pourquoi un champ `kind` plutôt que des routes dédiées.** Un challenge a exactement le même cycle de vie qu'un lab : même format, même simulateur, même rejeu des commandes, même verrou de session, même validation MCP dans le simulateur, mêmes statistiques. Des routes et des tables séparées auraient dupliqué tout cela pour trois différences (pas d'indice, échéance, fin à la réussite). Le champ `kind` (colonne `labs.kind`) filtre les listes, et ces trois différences sont des branches de `services/labs.ts`.

| Route | Points notables |
| --- | --- |
| `GET /labs?certification=&kind=challenge` | Liste des challenges (sans `kind`, les labs seuls) : temps cible, échéance, mode, meilleur temps. |
| `POST /labs/:slug/attempts` | Fixe `deadline_at` = départ + `timeLimitMinutes`, côté serveur. Un nouveau départ abandonne l'essai en cours du même challenge. |
| `POST /lab-attempts/:id/commands` | Après l'échéance (+ 5 s de tolérance réseau) : `409 challenge_expired` et l'essai est clos (`expired = true`) avec l'état rejoué à l'échéance. Tous les objectifs atteints : l'essai se termine d'office (`finished: true`), le chrono est figé. |
| `POST /lab-attempts/:id/hint` | `409 no_hints`. |
| `POST /lab-attempts/:id/finish` | À une seconde de l'échéance, c'est une fin par l'échéance (le navigateur l'appelle quand son compte à rebours atteint zéro). Sinon un abandon. |
| `GET /lab-attempts/:id` | Clôt aussi un essai dont l'échéance est passée. `result.faults` et `result.targetMinutes` à la fin. |
| `GET /labs/:slug/times` | Classement personnel : chaque essai terminé (temps, réussite, échéance), meilleur temps ; sert la courbe des temps. |
| `GET /lab-attempts?kind=challenge` | Historique filtré. |

Le compte à rebours du navigateur se recale sur `serverNow` (au chargement et à chaque commande), comme le chrono d'examen ; il ne s'annonce aux lecteurs d'écran qu'aux paliers 5 min, 1 min et 10 s (`role="timer"`, `aria-live="off"`, annonces dans une région polie).

MCP : `generate_challenge(theme, duree_cible)` donne la consigne ; la soumission, la relecture et la publication passent par `submit_lab`, `validate_lab` et `record_lab_review` (voir `docs/MCP.md`).

## Révision espacée

Flashcards : des QCM rapides (`mcq_single`, `mcq_multi`, `fill_blank`, `cli`) tirés de la banque publiée. Un paquet = un sous-thème, 10 à 20 cartes choisies de façon stable (`pickDeck`). L'algorithme est dans `packages/core/src/revision.ts`, sans I/O.

**Pourquoi Leitner plutôt que SM-2.** Les cartes sont corrigées automatiquement (juste ou faux), sans auto-évaluation de 0 à 5 ; SM-2 tire son facteur de facilité de cette note, et la déduire d'un QCM serait arbitraire. Leitner n'a besoin que de la réussite : boîtes 1 à 7, intervalles doublés (1, 2, 4, 8, 16, 32, 64 jours), une erreur renvoie en boîte 1. La prochaine échéance dépend donc de la réussite et de l'intervalle précédent. Les échéances tombent à minuit, heure locale (`tzOffsetMinutes` envoyé par le navigateur).

| Route | Points notables |
| --- | --- |
| `GET /revision?certification=` | Cartes dues aujourd'hui, paquets par sous-thème (inscrits ou disponibles), prochaine échéance. |
| `POST /revision/decks` | Ajoute le paquet d'un sous-thème (cartes dues tout de suite) ; sans effet s'il l'est déjà. |
| `POST /revision/sessions` | Jusqu'à 20 cartes dues, les plus en retard d'abord ; `subtopic` limite au sous-thème et ajoute son paquet au besoin (bouton « Flashcards » de « À revoir »). `409 nothing_due` s'il n'y a rien. |
| `POST /revision/sessions/:id/answers` | Correction immédiate (clé, explication, notes des distracteurs) et nouvelle boîte, nouvelle échéance. Une carte, une réponse par session. |
| `GET /revision/sessions[/:id]` | Historique ; état d'une session (la correction des seules cartes répondues). |

Comme en entraînement, la correction d'une carte n'est envoyée qu'après la réponse à cette carte. Les cartes appartiennent à leur utilisateur (`403` sinon), testé par l'API.

## Questions CLI

`normalizeCommand` ramène une commande à une forme canonique : casse, espaces, abréviations non ambiguës (`conf t`, `sh ip int br`), noms d'interface (`Gi0/0` = `GigabitEthernet0/0`, reconnus partout dès qu'ils contiennent un « / », et `GigabitEthernet 0/1` avec espace), plages et listes (`g1/0/1-2` = `g1/0/1 - 2`), adresses IPv6 (forme canonique RFC 5952, `2001:0DB8::0:1` = `2001:db8::1`) et ports nommés (`eq www` = `eq 80`). Comme dans IOS, un préfixe ambigu n'est pas développé et ne correspond donc pas. La liste de mots-clés est à plat ; pour quelques mots, l'abréviation se lit d'abord parmi ce qu'IOS accepte à cet endroit (`transport in`, `int ra`, `root pri`, `sw tr nat`, `channel-group 1 mode ac`). La casse est ignorée partout, mots de passe compris.

Une réponse CLI est ordonnée (`ordered: true`, par défaut) ou non. Dans une réponse ordonnée, `freeOrder` déclare des plages de lignes dont l'ordre est libre, typiquement les sous-commandes qui suivent `interface …`, `line vty …` ou `router ospf 1` : `[[1, 2]]` pour `interface Gi1/0/7`, `speed 100`, `duplex full`.

Les champs `int` des questions à compléter acceptent les espaces de milliers (`65 536`).

## Accessibilité

Objectif WCAG 2.1 AA, vérifié à chaque CI :
- **audit axe-core** (`@axe-core/playwright`) dans la suite e2e, sur toutes les pages, connecté et déconnecté (connexion, tableau de bord, lancement, examen en cours, résultats, historique, labs, lab en cours, challenges, révision, subnetting) : zéro violation « serious » ou « critical » ;
- **titres** : un seul `h1` par page et aucun niveau sauté (contrôle e2e) ;
- **zones cliquables** d'au moins 44 px (boutons, champs, onglets ; contrôle e2e à 390 px) ;
- **clavier** : focus visible partout (`:focus-visible`), blocs de code défilants focalisables, Tab jamais intercepté (le terminal garde la navigation ; la complétion passe par la barre tactile), seules les boîtes modales retiennent le focus ;
- **formulaires** : libellés reliés, erreurs reliées aux champs (`aria-describedby`, `aria-invalid`) ;
- **mouvement réduit** (`prefers-reduced-motion`) : jauge, barres, LED et transitions sans animation ;
- **lecteurs d'écran** : terminal en `role="log"`, objectifs annoncés quand ils se cochent, compte à rebours annoncé aux paliers seulement, correction des cartes en région polie.

## Performance et mobile

- **Découpage par route** : seuls la connexion et la coque sont dans le paquet initial ; chaque écran, et les graphiques qu'il utilise, se charge à la demande (`React.lazy`). Le schéma zod des réponses est à part (`response.ts`) : le navigateur note sans embarquer zod.
- **Budget** : `pnpm bundle:check` (`scripts/check-bundle.mjs`, en CI après le build) mesure le JavaScript et la CSS chargés avant le premier écran, compressés : 75 Ko et 10 Ko au plus (62,6 Ko et 7,3 Ko à la fin du bloc 5, contre 111,7 Ko de JavaScript avant).
- **Polices auto-hébergées** (`@fontsource`, sous-ensemble latin) : aucune requête vers un tiers, CSP réduite à `'self'`.
- **Mobile** : mise en page vérifiée à 360, 390, 768 et 1280 px ; terminal avec barre d'actions tactile (Ctrl+Z, ?, ↑, ↓, Tab), saisie à 16 px (pas de zoom iOS), compte à rebours collé sous l'en-tête.
- **Navigateurs** : `pnpm e2e:browsers` joue un test de fumée (connexion, examen court, lab) dans Chromium, Firefox et WebKit ; job CI non bloquant.

## Sécurité

- Mots de passe hachés en argon2id (paramètres OWASP). Le temps de réponse ne révèle pas si un e-mail existe.
- Session JWT dans un cookie `httpOnly`, `SameSite=Strict`, `Secure` en production.
- Connexion et inscription limitées à 5 essais par minute et par IP ; 300 requêtes par minute pour le reste.
- Toute entrée est validée par zod côté serveur. Le corps des requêtes est limité à 256 Ko.
- En-têtes de sécurité et CSP stricte servis par Caddy.
- Secrets uniquement en variables d'environnement (`.env` ignoré par git, secrets GitHub pour la CI).
- Détection basique de triche : un examen complet bouclé à moins de 5 s par question est marqué `suspicious`.
