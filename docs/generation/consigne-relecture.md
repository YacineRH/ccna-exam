# Consigne de relecture d'un lot de questions

Cette consigne est donnée à un agent **distinct** de celui qui a rédigé le lot : il n'a vu ni la rédaction ni ses échanges, seulement le fichier du lot. Il cherche les erreurs, il ne les suppose pas absentes.

## 1. Lire

Pour chaque question : énoncé, exhibit, options, correction (`key`), explication, notes des distracteurs, référence, difficulté. Le format est décrit dans `docs/generation/consigne-redaction.md` ; le contexte de la banque s'obtient avec
`node packages/content/scripts/batch-context.mjs <sous-thème> --full`.

## 2. Grille

1. **Exactitude IOS / CCNA 200-301** : la notion, la syntaxe, les valeurs par défaut, les sorties d'exhibit sont celles d'IOS / IOS XE actuels et du programme v1.1.
2. **Bonne réponse unique et vraie** : vraie dans tous les cas raisonnables ; aucune autre option défendable.
3. **Distracteurs faux sans ambiguïté**, y compris dans un cas limite (autre plateforme, autre version, valeur par défaut différente selon le modèle).
4. **Explication et notes justes** : chaque affirmation est exacte ; chaque note dit pourquoi l'option est fausse.
5. **Aucun indice** : accord grammatical (genre, nombre, élision) entre l'énoncé et une seule option, mot de l'énoncé repris par la seule bonne option, bonne réponse nettement plus longue ou plus nuancée, options non parallèles.
6. **Valeurs calculées vérifiées** : refaire chaque calcul (subnetting, VLSM, wildcards, résumés, coûts OSPF, coûts et BID STP, EUI-64, compression IPv6, numéros de séquence TCP…), de préférence avec un outil : `python3 -c "import ipaddress; print(ipaddress.ip_network('10.1.2.64/27'))"`.
7. **Énoncé complet et suffisant** ; type de question adapté ; difficulté réaliste (`easy` rappel, `medium` application, `hard` analyse en plusieurs étapes).
8. **CLI** : chaque commande attendue existe dans le mode du prompt ; les formes équivalentes courantes sont acceptées ; l'ordre imposé est le bon. **Champs à compléter** : toutes les écritures correctes sont acceptées, le libellé précise le format.
9. **Doublons** : la question n'en reprend pas une autre de la banque ou du lot, même reformulée.
10. **Français** correct et clair.

## 3. Décider

- **ok** : rien à redire.
- **corrigée** : le problème se corrige sûrement (valeur, option, note, formulation) ; corriger dans le fichier relu. Classer la correction : `fond` (erreur technique : mauvaise réponse, valeur fausse, distracteur défendable, explication fausse, commande refusée par IOS) ou `forme` (indice grammatical, formulation, faute, difficulté mal placée, forme CLI manquante).
- **rejetée** : la question ne peut pas être sauvée sûrement, ou fait doublon ; la retirer du fichier relu. **Au moindre doute technique, rejeter.**

## 4. Rendre

1. Écrire le lot relu (questions gardées, corrigées en place) dans le fichier de sortie indiqué.
2. Écrire le journal de relecture (JSON) : `[{ "slug", "verdict": "ok" | "corrigée" | "rejetée", "gravite": "fond" | "forme" | null, "problemes": ["…"], "correction": "…" }]`, une entrée par question du lot d'origine.
3. Lancer `node packages/content/scripts/check-batch.mjs <lot relu> --subtopics <codes>` : aucune erreur.
4. Répondre en 10 lignes au plus : nombre ok / corrigées (fond, forme) / rejetées, les trois problèmes les plus significatifs.
