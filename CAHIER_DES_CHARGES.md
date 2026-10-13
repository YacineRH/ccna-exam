# Cahier des charges – Simulateur d'examens CCNA évolutif

Oct 13, 2026

Ce document est le cahier des charges fonctionnel et technique d'une plateforme d'entraînement aux certifications IT, dont le premier produit est un simulateur d'examen CCNA. L'objectif : reproduire fidèlement les conditions de l'examen officiel (banque de \~100 examens blancs, interface chronométrée, types de questions variés), fournir un dashboard de suivi de performance par domaine, et brancher un serveur MCP qui permet à une IA de générer automatiquement de nouveaux examens, tests et challenges sans intervention manuelle. La plateforme est pensée dès le départ comme un moteur générique de certification, pas comme un outil figé sur le CCNA : l'architecture doit permettre d'ajouter d'autres certifications (Security+, PNPT, AWS, etc.) sans refonte. Déploiement : code sur GitHub, hébergement relié au nom de domaine OVH de Yacine, avec un vrai backend pour sauvegarder la progression (GitHub seul ne persiste pas l'état d'un utilisateur). Design : identité visuelle premium et distinctive, proche de l'expérience d'un vrai centre d'examen Pearson VUE / Cisco, pas un template générique.

## 1. Objectifs et périmètre

**Objectif principal** : construire l'outil de préparation CCNA le plus complet possible pour un usage personnel intensif, servant aussi de projet vitrine pour les candidatures (SOC, admin réseau/sécurité, intégrateur OT/IT).

**Périmètre v1 (CCNA, examen 200-301)** :

- Banque d'environ 100 examens blancs distincts, non répétitifs, couvrant les 6 domaines officiels (Network Fundamentals, Network Access, IP Connectivity, IP Services, Security Fundamentals, Automation & Programmability) selon leur pondération réelle à l'examen.
- Mode « examen blanc » fidèle aux conditions réelles (nombre de questions, temps limite, impossibilité de revenir en arrière selon paramétrage, pas de correction en direct).
- Mode « entraînement libre » avec feedback immédiat, par domaine ou par thème ciblé.

**Évolutivité (au-delà du CCNA)** : l'architecture doit traiter « certification » comme une entité de données configurable (domaines, pondérations, types de questions autorisés, barème de notation), pas comme du code spécifique au CCNA. Ajouter une nouvelle certification doit être une opération de configuration/contenu, jamais une réécriture du moteur.

## 2. Simulateur d'examen

**Banque de contenu** :

- \~100 examens blancs uniques (pas de simple melange aleatoire des memes questions) + une banque de questions atomiques taggees par domaine, sous-theme et niveau de difficulte, dans laquelle les examens piochent.
- Chaque question porte : enonce, domaine CCNA, sous-theme, difficulte, explication detaillee de la reponse (et pourquoi les distracteurs sont faux), source/reference.

**Mode examen (fidele au jour J)** :

- Chronometre visible, nombre de questions et duree configurables (calques sur le vrai format), barre de progression.
- Questions presentees une par une ou en liste selon le type (certaines certifications Cisco melangent navigation libre et questions verrouillees).
- A la fin : score global, seuil de reussite simule, score par domaine, temps passe par question.
- Historique complet de tous les examens passes (date, score, duree, domaine faible du jour).

**Types de questions a supporter** :

- QCM simple et QCM a reponses multiples.
- Questions a champs a completer (fill-in-the-blank), typiquement pour le subnetting (calcul d'adresse reseau, masque, broadcast, plage d'hotes, VLSM).
- Questions de commandes CLI a taper (simulateur de terminal Cisco IOS basique : validation syntaxique et semantique de la commande attendue, tolerance aux variantes equivalentes).
- Questions de type drag and drop / association (associer terme-definition, etape-ordre d'un processus).
- Questions de topologie interactive simplifiee (identifier un probleme sur un schema reseau, choisir ou placer une configuration).

**Exigence de robustesse (sans faille)** :

- Pas de doublons de questions dans un meme examen, pas de questions incoherentes ou mal taggees.
- Validation automatique de chaque question generee (reponse correcte techniquement exacte, distracteurs plausibles mais faux) avant publication dans la banque.

## 3. Moteur d'exercices pratiques

En plus des examens, des modules d'entrainement cible, independants de l'examen, avec repetition :

- **Subnetting trainer** : generateur infini d'exercices (adresse + masque ou CIDR donnes, l'utilisateur doit trouver network/broadcast/plage utile/nombre d'hotes, ou l'inverse : construire un plan VLSM a partir d'un besoin). Chronometre pour entrainer la rapidite de calcul mental, avec un mode sans limite de temps pour apprendre.
- **CLI trainer** : terminal simule Cisco IOS/IOS-XE dans le navigateur, scenarios guides (configurer une interface, un VLAN, du routage statique/OSPF basique, de l'ACL) avec verification commande par commande et indices progressifs.
- **Flashcards / QCM rapides** : revision par paquet de 10-20 questions sur un sous-theme precis, pour cibler un point faible identifie par le dashboard.
- **Challenges chronometres** : mini-defis generes par l'IA (ex. "configure ce reseau en moins de 10 minutes"), avec classement personnel dans le temps.
- Tous les modules partagent le meme moteur de notation et remontent leurs resultats au dashboard de suivi.

## 4. Suivi de performance et dashboard

- **Vue d'ensemble** : score moyen sur les N derniers examens, tendance (progression/regression), nombre total de questions traitees, temps cumule d'entrainement.
- **Radar par domaine** : pourcentage de maitrise pour chacun des 6 domaines CCNA (et leurs sous-themes), avec code couleur (maitrise / a consolider / faiblesse critique).
- **Liste priorisee "a revoir"** : generee automatiquement a partir des erreurs recentes et de la repetition espacee (spaced repetition) - les sous-themes avec le plus d'echecs remontent en premier, avec un lien direct vers un module d'entrainement cible.
- **Historique detaille** : chaque examen passe est consultable a posteriori (questions, reponses donnees, bonnes reponses, explications), pour analyse post-mortem.
- **Objectif de certification** : estimation du niveau de preparation global (pret / pas encore pret) base sur le score moyen recent pondere par domaine, comparee au seuil de reussite reel de l'examen vise.

## 5. Integration IA via MCP

Un serveur MCP dedie (ex. nomme `exam-forge-mcp`) expose des outils qu'une IA (Claude ou autre) peut appeler pour generer du contenu de maniere autonome et professionnelle, sans retouche manuelle ensuite :

- `generate_exam(certification, nombre_questions, difficulte, domaines_cibles)` - genere un examen blanc complet, respecte la ponderation officielle des domaines, verifie l'absence de doublons avec la banque existante.
- `generate_question(domaine, sous_theme, type_question, difficulte)` - genere une question atomique (QCM, fill-in-the-blank, commande CLI, etc.) avec sa reponse correcte, ses distracteurs et son explication.
- `generate_challenge(theme, duree_cible)` - genere un mini-challenge chronometre (scenario de config, troubleshooting).
- `validate_question(question_id)` - fait relire une question par l'IA pour verifier sa justesse technique et la qualite de ses distracteurs avant publication (double passe de controle qualite automatisee).
- `analyze_weakness(user_id)` - analyse l'historique d'un utilisateur et retourne les sous-themes prioritaires a travailler, utilise par le dashboard.
- `add_certification(nom, domaines, ponderations, types_questions_autorises)` - outil d'administration pour declarer une nouvelle certification sans toucher au code.

**Principe directeur** : chaque outil doit produire un resultat directement publiable (validation automatique integree : coherence technique, absence de doublon, qualite des distracteurs). Aucune etape manuelle de relecture/correction ne doit etre necessaire dans le flux normal - la supervision humaine reste possible mais optionnelle, pas un maillon obligatoire du pipeline.

## 6. Architecture technique

| Couche | Role | Pistes technos |
| --- | --- | --- |
| Frontend | Interface interactive (examens, trainer CLI/subnetting, dashboard) | React ou Vue + TypeScript, Tailwind pour un design sur-mesure |
| Backend / API | Logique metier, notation, orchestration des outils MCP, gestion des utilisateurs | Node.js (NestJS/Express) ou Python (FastAPI) |
| Base de donnees | Banque de questions/examens, comptes, historique, resultats | PostgreSQL (donnees relationnelles + JSONB pour le contenu des questions) |
| Authentification | Compte perso, plus tard comptes amis si partage | Auth maison (JWT) ou service managed (ex. Clerk/Auth.js) |
| Serveur MCP | Expose les outils de generation IA decrits en section 5 | Node ou Python, protocole MCP standard, appelable par Claude ou tout client MCP |
| Infra / hebergement | Deploiement du front, du back, de la base et persistance | Voir section 7 |

**Principes** :

- Separation stricte entre le moteur (gestion d'examens, notation, progression) et le contenu (questions, certifications), pour que l'ajout d'une certification soit une operation de donnees.
- API versionnee des le depart (ex. `/api/v1/...`) pour pouvoir faire evoluer le modele de donnees sans casser le frontend.
- Le serveur MCP et le backend applicatif communiquent via l'API interne : le MCP ne doit jamais ecrire directement en base sans passer par les regles de validation du backend.

## 7. Hebergement et deploiement

**Point cle a clarifier des le depart** : GitHub (via GitHub Pages) ne sait heberger que du contenu statique - il ne peut pas faire tourner un backend ni sauvegarder la progression d'un utilisateur. Le code source reste sur GitHub (versionning, historique, CI/CD), mais l'execution et la persistance doivent se faire ailleurs. Trois options realistes :

1. **Tout sur le VPS OVH existant** (coherent avec l'infra deja en place : homelab, vps-hydre) - backend + PostgreSQL + frontend serveur sur le VPS, nom de domaine OVH pointe dessus, deploiement automatise depuis GitHub (GitHub Actions qui build et pousse sur le VPS via SSH, ou webhook + Docker Compose). Avantage : controle total, coherent avec le reste de l'ecosysteme Yacine. A prevoir : reverse proxy (Traefik/Nginx) + HTTPS (Let's Encrypt), sauvegardes regulieres de la base.
2. **Frontend sur un hebergeur statique (Vercel/Netlify/GitHub Pages), backend + base sur le VPS OVH** - le nom de domaine OVH pointe vers le frontend statique, qui appelle l'API hebergee sur le VPS (sous-domaine type `api.tondomaine.fr`). Bon compromis rapidite de deploiement / controle des donnees.
3. **Full PaaS** (Render, Railway, Fly.io pour le backend + base managee) - plus simple a maintenir mais moins coherent avec la demarche "homelab/infra maitrisee" du profil de Yacine.

**Recommandation** : option 1 ou 2, pour rester coherent avec l'ecosysteme OVH/VPS/homelab deja documente et pour garder la main sur les sauvegardes de la progression - un argument fort a mettre en avant aupres de recruteurs (maitrise bout en bout : code, infra, deploiement, donnees).

**CI/CD** : GitHub Actions - tests automatiques + build a chaque push, deploiement automatique sur le VPS (ou sur le PaaS choisi) apres validation des tests, pas de mise en prod manuelle.

## 8. Design et identite visuelle

- **Direction** : esthetique "centre d'examen professionnel / cockpit technique" - sobre, dense en information utile, pas de design generique de template SaaS. Palette sombre type terminal/reseau (bleus nuit, accents cyan/vert pour le succes, rouge/orange pour les alertes), typographie monospace pour tout ce qui touche au CLI et aux adresses IP, typographie sans-serif nette pour le reste.
- **Reference d'inspiration** : l'interface d'examen Pearson VUE/Cisco (chronometre visible, navigation par numero de question, marquage "a revoir") combinee a des codes visuels type terminal reseau (ASCII-art discret, icones de type switch/routeur) pour ancrer l'identite reseau/cybersecurite.
- **Dashboard** : visualisations claires (radar ou barres par domaine, courbe de progression dans le temps), hierarchie visuelle forte entre ce qui est maitrise et ce qui est a revoir.
- **Coherence** : un systeme de design propre des le depart (tokens de couleur, typographie, espacements) pour que l'ajout d'une nouvelle certification ne demande pas de refaire l'UI - seul le contenu change, pas l'habillage.

## 9. Securite et qualite

- **Authentification/autorisation** : mots de passe haches (bcrypt/argon2), sessions/JWT avec expiration, protection brute-force sur le login.
- **Validation des entrees** : toute entree utilisateur (reponses, commandes CLI tapees) validee cote serveur, jamais de confiance aveugle au frontend.
- **Anti-triche basique** : limitation du nombre de tentatives, detection de temps de reponse anormalement rapide sur un examen complet, pas d'exposition des bonnes reponses dans le JSON envoye au client avant soumission.
- **Secrets** : cles API (notamment pour l'IA generatrice) en variables d'environnement, jamais commitees sur GitHub (`.env` dans `.gitignore`, usage de GitHub Secrets pour la CI/CD).
- **Tests automatises** : tests unitaires sur le moteur de notation et le generateur de questions, tests d'integration sur l'API, executes a chaque push via GitHub Actions avant tout deploiement.
- **Supervision** : logs applicatifs centralises, alertes basiques sur erreurs serveur - coherent avec les reflexes deja en place dans le homelab de Yacine (monitoring).

## 10. Roadmap par phases

1. **Phase 0 - Socle** : schema de donnees (questions, examens, certifications, utilisateurs, resultats), API minimale, auth, deploiement initial GitHub -> VPS OVH fonctionnel (meme vide).
2. **Phase 1 - Moteur d'examen** : creation/passage d'un examen, notation, historique simple, banque de depart (quelques dizaines de questions ecrites/importees a la main pour valider le moteur).
3. **Phase 2 - Dashboard** : suivi par domaine, liste "a revoir", historique detaille des examens passes.
4. **Phase 3 - Serveur MCP et generation IA** : implementation des outils decrits en section 5, generation automatisee pour atteindre les \~100 examens, pipeline de validation automatique.
5. **Phase 4 - Modules d'entrainement avances** : subnetting trainer, CLI trainer, challenges chronometres.
6. **Phase 5 - Design final et polish** : identite visuelle definitive, accessibilite, responsive mobile.
7. **Phase 6 - Evolutivite** : ajout d'une 2e certification (ex. Security+) pour valider que l'architecture est bien generique, outil d'administration pour en ajouter d'autres facilement.

## 11. Prompt de contexte pour Claude Code

A copier-coller tel quel comme premier message dans Claude Code :

```markdown
Contexte du projet : je construis une plateforme d'entrainement aux certifications IT, dont le premier produit est un simulateur d'examen CCNA complet. Le cahier des charges complet est dans ce document (sections 1 a 10) : [coller le lien de ce doc, ou son contenu].

Points non negociables :
- Le moteur doit etre generique (certification = donnees de config), pas code en dur pour le CCNA.
- Backend + base de donnees reelle (pas seulement du statique sur GitHub Pages) pour persister la progression utilisateur.
- Un serveur MCP expose les outils de generation (examens, questions, challenges) decrits en section 5, utilisable par une IA de maniere autonome.
- Design sur-mesure (pas de template generique), identite visuelle decrite en section 8.
- Code sur GitHub, deploiement vise sur un VPS OVH + nom de domaine personnel (voir section 7 pour les options d'hebergement).

Ce que j'attends de toi pour demarrer :
1. Proposer un schema de base de donnees (certifications, domaines, questions, examens, utilisateurs, resultats, tentatives).
2. Proposer la structure du depot (monorepo frontend/backend/mcp-server ou repos separes) et la stack technique definitive.
3. Mettre en place le squelette du projet avec CI/CD GitHub Actions (tests + build).
4. Avancer phase par phase selon la roadmap en section 10, en me proposant a chaque etape des points de validation avant de continuer.

Pose-moi les questions necessaires avant de generer du code si des choix structurants manquent (ex. stack precise, mode d'hebergement retenu).
```
