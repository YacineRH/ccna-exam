# Architecture

ExamForge est un moteur générique de certification. Le CCNA 200-301 est sa première configuration et la CompTIA Security+ SY0-701 sa deuxième (bloc 7) : aucune des deux n'est une partie du code.

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

- **Une certification est une donnée.** `certificationSchema` (packages/core) décrit domaines, pondérations, sous-thèmes, barème, format d'examen, types de questions autorisés et **modules** proposés. Ajouter une certification = un fichier JSON ou un appel à `add_certification` (voir « Généricité du moteur et modules » : la Security+ l'a prouvé sans une ligne de code propre à elle).
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
- **`certification`** : l'écran de passage et les résultats utilisent la certification de la tentative, pas celle choisie dans l'en-tête. Le tableau de bord, le lancement, la série, l'entraînement, les flashcards, les statistiques et l'historique suivent le sélecteur de l'en-tête (liste issue de `GET /certifications`, choix gardé dans `localStorage`, repli sur la première certification). Progression, statistiques, série et numéros d'examen sont propres à chaque certification : un examen CCNA ne compte jamais dans la Security+.

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

## Généricité du moteur et modules (bloc 7)

Le bloc 7 devait prouver que le moteur est générique : la Security+ s'ajoute par des **données** et du **contenu**, sans code propre à une certification.

### Audit de généricité

Recherche de `ccna`, `200-301`, `825`, `102`, `IOS`, `Cisco`, des domaines 1.0 à 6.0 et des sous-thèmes dans `packages/core`, `apps/api`, `apps/web` et `apps/mcp` (hors tests).

| Trouvé en dur | Devenu |
| --- | --- |
| Menu « CLI Cisco IOS », titres et en-têtes « LABS CISCO IOS », méta-description « examens blancs CCNA 200-301 » (web) | « Labs CLI » et textes sans certification ; le menu, le tableau de bord et l'écran de lancement suivent `modules` |
| Sous-thème `'1.6'` qui ouvre le bouton « Trainer » du tableau de bord (web) | `moduleSubtopics: { subnet: ["1.6"] }` dans `ccna.json` |
| Navigation, tableau de bord et lancement qui supposaient labs, challenges, subnetting et série | `modules: [...]` de la certification ; API : 404 `module_unavailable` |
| Libellé du sélecteur construit sur le code en capitales | `shortName` (« CCNA », « Security+ ») dans la configuration |
| Descriptions des outils MCP : « IOS », « Cisco », « pannes CCNA classiques », `ex. "ccna"` | Textes neutres ; le contenu propre à une certification vit dans les consignes de lot (`docs/generation/`) |
| Cibles chiffrées (1 500 questions, 15 par sous-thème, 100 examens, N = 8, 12 en commun, 825…) écrites dans les tests | `packages/content/data/bank-targets/<code>.json`, lu par des tests paramétrés |
| Barème 300–1000, seuil 825, 102 questions, 120 minutes | Déjà en données (`scoring`, `examFormat`) : vérifié sur une échelle 100–900 avec seuil 750 (test d'API) |

Un test (`packages/content/test/genericity.test.ts`) échoue si `ccna`, `200-301` ou `cisco` apparaît dans le code de core, api, web ou mcp, hors tests et commentaires.

### Modules

`modules` est une liste de la configuration de certification : `exam`, `practice`, `flashcards`, `subnet`, `cli`, `challenges`. Valeur par défaut d'une certification déclarée sans liste : `exam`, `practice`, `flashcards` (ceux qui ne demandent que des questions). `challenges` suppose `cli` (même simulateur).

| Module | Ce qu'il ouvre | Routes qui répondent 404 `module_unavailable` sans lui |
| --- | --- | --- |
| `exam` | Examens blancs, série figée, chrono officiel | `POST /attempts` en mode `exam` ou avec `examNumber`, `GET /exams` |
| `practice` | Entraînement libre et ciblé | `POST /attempts` en mode `practice` |
| `flashcards` | Révision espacée | `/revision/*` |
| `subnet` | Entraîneur de subnetting (calcul côté navigateur, sans route) | page du navigateur seulement |
| `cli` | Labs dans le simulateur de terminal | `GET /labs`, `/labs/:slug`, sessions de lab |
| `challenges` | Challenges chronométrés (`kind: "challenge"`) | `GET /labs?kind=challenge`, leurs sessions |

L'API répond `404 { error: { code: "module_unavailable", details: { certification, module } } }` : une réponse propre, sans effet de bord. Côté navigateur, `ModuleGate` affiche « Module absent pour <certification> » sur un lien direct, et la navigation, le tableau de bord (boutons, « À revoir ») et l'écran de lancement ne proposent que les modes disponibles. La Security+ déclare `["exam", "practice", "flashcards"]`.

### Deux voies pour déclarer une certification, un seul résultat

- **Fichier de données** : `packages/content/data/certifications/<code>.json`, importé au démarrage (`seedContent`).
- **Outil MCP `add_certification`** : envoie le même objet à `POST /admin/certifications` (validé par `certificationSchema`, comme le fichier).

Le test `apps/api/test/certifications.test.ts` déclare le fichier de la Security+ sous un autre code par l'API et vérifie que la configuration servie, les domaines, les pondérations et les sous-thèmes en base sont identiques ; `apps/mcp/test/tools.test.ts` vérifie que l'outil transmet le fichier sans rien perdre (modules compris). Déclarer deux fois ne crée rien de plus.

### Écran d'administration

`/admin` (rôle administrateur, lecture seule) liste les certifications : format et barème, modules, compteurs de banque par statut (publiées, validées, brouillons, retirées), labs, **état de la série** (examens figés, passés, « déjà passés gardés tels quels » si un import a trouvé un écart) et **date du dernier import** avec son résumé (questions créées et mises à jour). Il lit `GET /admin/certifications`. Une certification déclarée par l'API seulement n'a « jamais été importée » (`certifications.last_imported_at`, `last_import`, migration `0003`).

### Évolutions génériques du simulateur de terminal

Deux limites du bloc 6 sont levées par des champs du **profil**, sans rien d'IOS dans le moteur :

- **Mots-clés facultatifs dans un ordre libre** : `[* [a] [b] [c] *]` dans une syntaxe (`service timestamps log datetime [* [msec] [localtime] [show-timezone] [year] *]`). Chaque option au plus une fois, dans n'importe quel ordre, abréviations comprises ; la configuration affichée les range dans l'ordre de la syntaxe (`canonicalOrder`). L'aide `?` ne propose que les options restantes. Le groupe ne contient que des options de mots-clés (une valeur perdrait son rang).
- **`negateGroup`** : la forme `no`, même incomplète, remet à son défaut tout le réglage du `keyGroup` qui a la même clé. `no spanning-tree vlan 10 root` retire aussi `spanning-tree vlan 10 priority 4096`.

Tests : `packages/core/test/terminal.test.ts` (syntaxe) et `packages/content/test/profile-fidelity.test.ts` (comportement IOS).

### Test d'API « mode examen » : cause trouvée

Au bloc 6, le test « mode examen : pas de correction avant la fin… » a échoué une fois sans que l'erreur soit conservée. Cause : il cherchait les mots `"key"`, `"correct"`, `"accepted"`… **dans le JSON sérialisé** de l'état de la tentative. Or une question d'association de la banque (`ccna-4.8-commands-roles-001`) a une option dont l'**identifiant** est `key` (`{"id":"key","text":"crypto key generate rsa…"}`) : quand le tirage aléatoire la sélectionnait (environ 1 tirage de 10 questions sur 150 : 3 échecs sur 300 tirages rejoués, tous sur cette question), la recherche de texte la prenait pour une fuite de correction. Le test cherche désormais des **noms de propriétés** (`CORRECTION_FIELDS`) à toute profondeur, et un second test force le tirage de cette question pour que le cas soit joué à chaque passage. Lors de la reproduction, un premier essai de 300 tirages a aussi échoué sur le plafond de requêtes (429), sans rapport : il est relevé dans l'essai. L'échec ne venait donc pas d'une fuite : la garantie « jamais de correction avant la soumission » reste testée, sans faux positif.

## Banque complète et série de 100 examens blancs (bloc 6)

Le cahier des charges demande « ~100 examens blancs uniques, pas un simple mélange aléatoire des mêmes questions ». Les chiffres ci-dessous ont été fixés avant la génération ; les tests de contenu (`packages/content/test/series.test.ts`, `content.test.ts`) les vérifient.

### Ce que demande la série

Un examen CCNA compte 102 questions, réparties par `allocateByWeight` : **21 / 20 / 26 / 10 / 15 / 10** questions pour les domaines 1.0 à 6.0 (20,4 / 20,4 / 25,5 / 10,2 / 15,3 / 10,2, arrondis au plus fort reste). Cent examens font donc **10 200 places** : 2 100, 2 000, 2 600, 1 000, 1 500 et 1 000 par domaine.

### Cibles de la banque CCNA : 1 530 questions publiées

Chaque domaine reçoit une part de la banque égale à sa part des places, pour que la réutilisation moyenne soit la même partout : **10 200 / 1 530 = 6,67 examens par question**. Les parts restent à moins d'un point des pondérations officielles.

| Domaine | Poids | Places / examen | Cible | Part de la banque | Réutilisation moyenne |
| --- | --- | --- | --- | --- | --- |
| 1.0 Network Fundamentals | 20 % | 21 | 315 | 20,6 % | 6,67 |
| 2.0 Network Access | 20 % | 20 | 300 | 19,6 % | 6,67 |
| 3.0 IP Connectivity | 25 % | 26 | 390 | 25,5 % | 6,67 |
| 4.0 IP Services | 10 % | 10 | 150 | 9,8 % | 6,67 |
| 5.0 Security Fundamentals | 15 % | 15 | 225 | 14,7 % | 6,67 |
| 6.0 Automation and Programmability | 10 % | 10 | 150 | 9,8 % | 6,67 |
| **Total** | | **102** | **1 530** | | |

Le minimum demandé (1 500) laisse 30 questions de marge pour les rejets de la relecture. Banque publiée à la fin du bloc 6 : **1 523 questions** (bilan des relectures dans `docs/generation/journal-bloc-6.md`). **Sous-thèmes** : au moins 15 questions chacun (test), réparties selon le poids du sous-thème dans le programme :

| Domaine | Cibles par sous-thème |
| --- | --- |
| 1.0 | 1.1 : 25, 1.2 : 22, 1.3 : 22, 1.4 : 22, 1.5 : 24, 1.6 : 45, 1.7 : 16, 1.8 : 24, 1.9 : 24, 1.10 : 18, 1.11 : 23, 1.12 : 18, 1.13 : 32 |
| 2.0 | 2.1 : 45, 2.2 : 42, 2.3 : 28, 2.4 : 38, 2.5 : 50, 2.6 : 28, 2.7 : 20, 2.8 : 24, 2.9 : 25 |
| 3.0 | 3.1 : 75, 3.2 : 70, 3.3 : 90, 3.4 : 105, 3.5 : 50 |
| 4.0 | 4.1 : 24, 4.2 : 16, 4.3 : 15, 4.4 : 16, 4.5 : 16, 4.6 : 16, 4.7 : 17, 4.8 : 15, 4.9 : 15 |
| 5.0 | 5.1 : 24, 5.2 : 16, 5.3 : 22, 5.4 : 20, 5.5 : 20, 5.6 : 38, 5.7 : 33, 5.8 : 20, 5.9 : 16, 5.10 : 16 |
| 6.0 | 6.1 : 18, 6.2 : 20, 6.3 : 24, 6.4 : 18, 6.5 : 26, 6.6 : 20, 6.7 : 24 |

**Types** (cible sur la banque entière) : QCM simple 40 %, QCM multiple 18 %, champs à compléter 10 %, CLI 11 %, remise en ordre 9 %, association 11 %. Chaque domaine contient les six types, au moins 5 questions de chacun, sauf la CLI en 6.0 : le type `cli` corrige des commandes IOS, et le domaine Automation porte sur des API, des formats et des outils qui ne se tapent pas dans IOS.

**Difficultés** : 30 % faciles, 50 % moyennes, 20 % difficiles sur la banque (à 3 points près) et dans chaque domaine (à 5 points près).

### Contraintes de la série

| Contrainte | Valeur | Justification |
| --- | --- | --- |
| Examens | 100, numérotés de 1 à 100, au format officiel (102 questions, pondérations exactes) | Cahier des charges. |
| Doublon dans un examen | aucun | Clé primaire `(exam_id, question_id)` et contrôle de la série. |
| **N** : examens par question, au plus | **8** | La moyenne est 6,67, donc le plancher est 7. Un cran de plus laisse à l'assembleur la latitude d'équilibrer sous-thèmes et difficultés sans dépasser, et absorbe une banque un peu plus mince après rejets (150 → 140 questions en 4.0 donnerait 7,1). |
| Recouvrement entre deux examens, au plus | **12 questions (11,8 %)** | Deux examens tirés au hasard dans une banque équilibrée partagent en moyenne Σ k²/n = 21²/315 + 20²/300 + 26²/390 + 10²/150 + 15²/225 + 10²/150 ≈ **6,8 questions** ; le plafond tolère l'écart d'un tirage, sous les 15 % demandés. |
| Couverture | chaque question publiée sert au moins une fois | Une question jamais servie serait du contenu perdu. |
| Équilibre par examen | difficultés à 5 points près de 30/50/20 ; au moins 45 des 53 sous-thèmes | Chaque examen ressemble au vrai, pas seulement la série en moyenne. |

### Assemblage de la série (`packages/core/src/series.ts`)

`assembleSeries(pool, cert, { seed, examCount, maxUses, maxOverlap })` construit les examens un par un, domaine par domaine (l'ordre des domaines tourne d'un examen à l'autre). Pour chaque place, il retient la question de coût minimal :

1. **réutilisation** : les questions les moins servies du domaine d'abord (40 par utilisation au-dessus du minimum du domaine) ; c'est ce qui garantit que chaque question sert et que l'écart reste d'une utilisation ;
2. **recouvrement** : pour chaque examen précédent qui contient déjà la question, le carré du recouvrement qu'elle créerait ; au-delà du plafond, la question est exclue ;
3. **sous-thèmes** : au prorata de leur taille dans la banque, avec un bonus pour un sous-thème encore absent de l'examen ;
4. **difficultés** : au plus près des parts visées (30/50/20) ;
5. un départage tiré du seed.

Une seconde passe échange, s'il le faut, une question contre une autre du même domaine (même sous-thème et même difficulté de préférence) pour placer une question jamais servie ou ramener une paire sous le plafond. Le tout est déterministe : même banque et même seed, même série, quel que soit l'ordre de la banque. S'il manque des questions, `InsufficientBankError` dit le domaine et le nombre manquant (`needed`, `available`, `missing`) ; une contrainte intenable lève `SeriesConstraintError`.

`seriesReport` rend la réutilisation par question (minimum, maximum, moyenne, histogramme, questions jamais servies), le recouvrement maximal et moyen (avec la paire la plus proche et l'histogramme), et pour chaque examen les domaines, types, difficultés et sous-thèmes couverts. `checkSeries` contrôle une série figée relue depuis un fichier.

### Doublons sémantiques (`packages/core/src/similarity.ts`)

L'empreinte exacte (`contentKey`, énoncé, exhibit et choix normalisés ; SHA-256 en base) ne voit pas une reformulation. `compareQuestions` combine trois signaux :

- **texte** : énoncé et exhibit, sans casse, accents, ponctuation, mots vides ni valeurs, réduits à des racines de 5 lettres ; moyenne du Jaccard et du coefficient de recouvrement des racines ;
- **valeurs** : adresses IPv4 et IPv6 avec préfixe, MAC, nombres d'au moins deux chiffres (les heures des sorties IOS sont ignorées) ;
- **bonne réponse** normalisée, quel que soit le type (texte des options justes, valeurs attendues, commandes, ordre, paires).

`score = texte × (1 si même réponse, 0,6 sinon) × (0,4 + 0,6 × Jaccard des valeurs, ou 1 sans valeurs)`. Un même gabarit sur d'autres valeurs est un autre exercice (score bas), une même question reformulée avec les mêmes valeurs et la même réponse reste haute. **Seuil de doublon : 0,70** (bloquant dans les tests de contenu) ; **seuil de suspicion : 0,50** (liste de paires à relire, `node packages/content/scripts/near-duplicates.mjs`). Les cas de calibrage sont dans `packages/core/test/similarity.test.ts`. Toute la banque (environ 1,2 million de paires) se compare en moins d'une seconde : un filtre sur le recouvrement des racines écarte d'abord les paires sans rapport.

## Banque Security+ et série de 30 examens blancs (bloc 7)

Mêmes principes qu'au bloc 6 (la série est assemblée par `assembleSeries`, sans la moindre modification du moteur) ; les chiffres sont des **données** (`packages/content/data/bank-targets/security-plus.json`) que les tests paramétrés `packages/content/test/series.test.ts` lisent, comme pour le CCNA (`bank-targets/ccna.json`).

### Ce que demande la série

Un examen SY0-701 compte 90 questions en 90 minutes, seuil 750 sur une échelle de 100 à 900. `allocateByWeight` les répartit **11 / 20 / 16 / 25 / 18** pour les domaines 1.0 à 5.0 (10,8 / 19,8 / 16,2 / 25,2 / 18). Trente examens font donc **2 700 places** : 330, 600, 480, 750 et 540 par domaine.

### Cibles de la banque : au moins 900 questions publiées

| Cible | Valeur | Test |
| --- | --- | --- |
| Questions publiées | au moins 900 (cible de rédaction : 958 en 33 lots, plus un complément de 20) | `compte au moins 900…` |
| Pondérations | chaque domaine à moins d'un point de son poids officiel (12 / 22 / 18 / 28 / 20 %) | `suit les pondérations…` |
| Sous-thèmes | au moins 12 questions par sous-thème (28 sous-thèmes, 1.1 à 5.6) | `a au moins 12 questions par sous-thème…` |
| Types | les 5 types autorisés (`mcq_single`, `mcq_multi`, `matching`, `ordering`, `fill_blank`) dans chaque domaine, au moins 5 de chacun ; aucun `cli` ; au moins 15 % de QCM multiples | `a chaque type autorisé…`, `dose les types` |
| Difficultés | 30 % faciles, 50 % moyennes, 20 % difficiles : à 3 points près sur la banque, à 5 points près dans chaque domaine | `dose les difficultés…` |
| Qualité | une référence et une explication pour chaque question, une note par distracteur, aucun quasi-doublon (score ≥ 0,70) | tests de contenu |
| Origine | questions `source: "ai"`, rédigées en lots puis relues par un agent distinct | `garde la source…` |

Banque publiée à la fin du bloc 7 : **928 questions** (bilan des relectures dans `docs/generation/journal-bloc-7.md`).

| Domaine | Poids | Questions | Part | mcq_single | mcq_multi | matching | ordering | fill_blank | faciles / moyennes / difficiles |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.0 General Security Concepts | 12 % | 117 | 12,6 % | 59 | 24 | 14 | 8 | 12 | 30 / 50 / 21 % |
| 2.0 Threats, Vulnerabilities, and Mitigations | 22 % | 202 | 21,8 % | 103 | 41 | 26 | 11 | 21 | 32 / 51 / 17 % |
| 3.0 Security Architecture | 18 % | 167 | 18,0 % | 83 | 34 | 20 | 14 | 16 | 30 / 50 / 20 % |
| 4.0 Security Operations | 28 % | 261 | 28,1 % | 132 | 56 | 33 | 15 | 25 | 30 / 50 / 20 % |
| 5.0 Security Program Management and Oversight | 20 % | 181 | 19,5 % | 91 | 36 | 22 | 14 | 18 | 29 / 52 / 19 % |
| **Total** | 100 % | **928** | | 468 | 191 | 115 | 62 | 92 | 30 / 50 / 19 % |

Sous-thèmes (minimum 18, cible 12) : 1.1 : 21, 1.2 : 36, 1.3 : 20, 1.4 : 40 · 2.1 : 29, 2.2 : 42, 2.3 : 45, 2.4 : 47, 2.5 : 39 · 3.1 : 41, 3.2 : 50, 3.3 : 38, 3.4 : 38 · 4.1 : 31, 4.2 : 20, 4.3 : 33, 4.4 : 33, 4.5 : 36, 4.6 : 39, 4.7 : 18, 4.8 : 27, 4.9 : 24 · 5.1 : 36, 5.2 : 40, 5.3 : 24, 5.4 : 29, 5.5 : 25, 5.6 : 27.

**Ordonnancements.** Seules des séquences normées et sans ambiguïté sont admises (phases NIST SP 800-61, ordre de volatilité RFC 3227, cycle de gestion des vulnérabilités, étapes d'un changement…) : la banque en compte 62 (6,7 %, contre 8 % visés), parce que ces séquences sont peu nombreuses et que les relectures ont rejeté plusieurs ordonnancements qui répétaient celui d'un autre lot (mêmes phases NIST SP 800-61, même ordre de volatilité). Chaque domaine en a au moins 8.

### N et recouvrement, calculés

La banque (928 questions) est répartie comme les places : 2 700 / 928 = **2,91 examens par question en moyenne**, donc un plancher de 3.

| Contrainte | Valeur | Justification |
| --- | --- | --- |
| Examens | 30, numérotés de 1 à 30, au format officiel (90 questions, pondérations exactes) | Cahier des charges. |
| **N** : examens par question, au plus | **4** | La moyenne est 2,91, le plancher 3. Le plafond 4 laisse à l'assembleur la latitude d'équilibrer sous-thèmes et difficultés, et absorbe une banque un peu plus mince. |
| Recouvrement entre deux examens, au plus | **13 questions (14,4 %)** | Deux examens tirés au hasard partagent en moyenne Σ k²/n = 11²/117 + 20²/202 + 16²/167 + 25²/261 + 18²/181 ≈ **8,7 questions** ; le plafond tolère l'écart d'un tirage, sous les 15 % demandés. |
| Couverture | chaque question publiée sert au moins une fois | Une question jamais servie serait du contenu perdu. |
| Équilibre par examen | difficultés à 5 points près de 30/50/20 ; au moins 26 des 28 sous-thèmes | Chaque examen ressemble au vrai, pas seulement la série en moyenne. |

**Résultat** (seed 70101, assemblée en 0,2 s) : examens par question min 2, moyenne 2,91, **max 4** (842 questions à 3 examens, 85 à 2, 1 à 4) ; questions jamais servies **0** ; questions communes à deux examens moyenne 6,02 (6,7 %), **max 11** (12,2 %, examens 8 et 27) ; sous-thèmes couverts par examen 28 sur 28 ; difficultés par examen 27–28 / 45–46 / 16–18. `node packages/content/scripts/build-series.mjs --cert security-plus --check` vérifie que le fichier est exactement ce que l'assembleur produit avec la banque actuelle.

### Cycle de rédaction (mêmes règles qu'au bloc 6)

Lots de 20 à 40 questions rédigées (34 lots au total, complément compris), `batch:context`, `batch:check` (schéma, rangement, doublons exacts et sémantiques) et `near-duplicates` ; relecture par un agent **distinct** de celui qui rédige ; échantillon de 5 % relu par une troisième passe (au-delà de 2 % d'erreurs de fond, relecture complète du lot) ; `source: "ai"`, un commit par domaine, journal `docs/generation/journal-bloc-7.md`. Consignes adaptées dans `docs/generation/annexe-security-plus.md` : questions de scénario (« Un analyste constate… »), référentiels NIST SP 800-x, RFC, ISO/IEC 27001 et 27002, CVSS, MITRE ATT&CK, **aucune référence inventée** (un numéro de section ou d'identifiant n'est cité que s'il est sûr), point de vue du défenseur (jamais de charge utile ni de procédure d'attaque).

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

La banque CCNA compte 24 labs et 17 challenges (11 de dépannage). Chaque sous-thème que le programme fait configurer ou vérifier en CLI IOS a au moins un lab (test `labs ccna : couverture`) : 1.3, 1.8, 2.1 à 2.5, 2.8, 3.3 à 3.5, 4.1 à 4.6, 4.8, 5.3, 5.4, 5.6 à 5.8 ; l'adressage IPv4 (1.6) est exercé par le lab 1.3. Les autres sous-thèmes portent sur des concepts, le sans-fil (interface graphique du WLC) ou l'automatisation.

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
| `<-23-23>` (bornes signées), mots-clés avec `+` | Entier négatif accepté si la borne basse l'est ; mot-clé `tacacs+`. | `clock timezone EST -5` ; `group tacacs+` |
| `rewrite` en liste | Plusieurs règles, la première qui correspond s'applique (forme `no` comprise). | `logging trap 4` → `logging trap warnings` ; `address ipv4 …` complétée des ports 1645/1646 ; `clock timezone CET 1` → `… 1 0` |
| `defaults` | Forme canonique égale au défaut : le réglage est retiré au lieu d'être affiché. | `cdp timer 60`, `spanning-tree port-priority 128`, `logging trap informational`, `login authentication default` |
| `negate: "disable"` | Réglage actif par défaut et à valeur : `no …` garde « no » + la clé, une forme positive l'efface. | `no logging console`, `logging console warnings` |
| `negateKey` | La forme `no` peut s'arrêter après la clé alors que la syntaxe exige encore un mot-clé. | `no spanning-tree guard`, `no aaa authentication login default` |
| `requires[].invalidAtWord` | Refus présenté comme une saisie invalide, marqueur sous un mot-clé. | `aaa authentication …` et `login authentication …` sans `aaa new-model` |
| `display` | Un mot facultatif absent ne laisse pas d'espace final. | `snmp-server community public RO [10]` |

Pour la vitesse, la lecture d'une ligne ne suit que les formes dont le premier mot-clé peut commencer comme le premier mot saisi (les quatre méthodes de `aaa authentication login` font à elles seules 9 360 formes linéaires).

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
