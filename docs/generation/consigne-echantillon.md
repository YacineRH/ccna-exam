# Consigne du contrôle d'échantillon (troisième passe)

Après publication, une troisième passe relit au hasard **5 % des questions publiées de chaque lot** (au moins une par lot), sans connaître ni la rédaction ni la relecture. Elle mesure un taux d'erreur ; au-delà de **2 %** d'erreurs dans l'échantillon d'un lot, tout le lot est relu de nouveau.

> **Par certification.** Les exemples ci-dessous sont ceux du CCNA. Pour une autre certification, passer `--cert <code>` à tous les scripts et lire son annexe, qui l'emporte en cas de conflit : `annexe-security-plus.md` pour la Security+ (SY0-701).

## Tirage

Les slugs de l'échantillon sont tirés par un script déterministe (seed noté dans le journal), lot par lot, dans `packages/content/data/questions/ccna/`. L'agent reçoit la liste des slugs et lit chaque question dans les fichiers de la banque.

## Grille

La même que la relecture (`docs/generation/consigne-relecture.md`, section 2). Une question est **en erreur** si elle a un défaut de fond : bonne réponse fausse ou discutable, distracteur défendable, valeur calculée fausse, explication ou note fausse, commande refusée par IOS ou forme correcte refusée par la correction, énoncé incomplet. Un défaut de forme (formulation, faute, indice léger) est noté à part et ne compte pas dans le taux.

## Rendu

Un journal JSON : `[{ "slug", "lot", "verdict": "ok" | "erreur" | "forme", "probleme": "…", "correction": "…" }]`, et un résumé : questions lues, erreurs de fond, défauts de forme, taux d'erreur par lot et global. L'agent ne modifie pas la banque : les corrections sont appliquées ensuite, et un lot au-delà de 2 % repart en relecture complète.
