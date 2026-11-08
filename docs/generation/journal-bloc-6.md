# Journal des relectures du bloc 6

Banque CCNA portée de 222 à 1 523 questions : 1 346 questions rédigées en 45 lots (43 lots du plan, puis 2 lots de complément après les rejets), chacun relu par un agent distinct qui n'avait vu ni la rédaction ni ses échanges. Consignes : `consigne-redaction.md`, `consigne-relecture.md`, `consigne-echantillon.md`. Toutes les questions publiées portent `source: "ai"`.

## Bilan

| | Questions | Part |
| --- | --- | --- |
| Rédigées | 1 346 | 100 % |
| Gardées telles quelles | 1 009 | 75,0 % |
| Corrigées sur le fond (réponse, valeur, distracteur défendable, explication fausse, commande refusée) | 71 | 5,3 % |
| Corrigées sur la forme (indice grammatical ou de longueur, formulation, forme CLI manquante, difficulté) | 222 | 16,5 % |
| Rejetées (doublons pour la plupart, hors programme, ordre non unique, comportement IOS incertain) | 44 | 3,3 % |
| **Publiées** | **1 302** | |

Une question publiée a ensuite été retirée au contrôle d'échantillon (quasi-doublon) : 1 301 questions `ai` dans la banque.

Fautes de fond les plus fréquentes, toutes corrigées avant publication : explications trop absolues (« toujours », « jamais ») démenties par un cas IOS réel, adresse d'exhibit impossible (next hop égal à l'adresse de diffusion d'un /30), distracteur défendable dans un cas limite, comportement de plate-forme présenté comme général, référence citant une section incertaine (retirée). Rejets : doublons avec la banque ou dans le lot (35), hors programme 200-301 v1.1 (MQC à configurer, distance OSPF, Open vSwitch, Kill Chain), ordre à remettre non unique, sortie IOS non vérifiable.

## Contrôle d'échantillon

5 % des questions publiées de chaque lot (au moins une par lot), tirées par un script déterministe, relues par une troisième passe.

| Domaine | Questions relues | Erreurs de fond | Défauts de forme corrigés |
| --- | --- | --- | --- |
| 1.0 | 17 | 0 | 1 |
| 2.0 | 16 | 0 | 1 |
| 3.0 | 20 | 0 | 3 |
| 4.0 | 9 | 0 | 0 |
| 5.0 | 12 | 0 | 3 (dont un quasi-doublon retiré) |
| 6.0 | relu en entier par deux lots de relecture et un complément (voir ci-dessous) | | |
| **Total** | **74** | **0 (0 %)** | **8** |

Aucun lot ne dépasse le seuil de 2 % : aucune relecture complète n'a été relancée.

## Par lot

| Lot | Sous-thèmes | Rédigées | ok | Corrigées (fond) | Corrigées (forme) | Rejetées | Publiées |
| --- | --- | --- | --- | --- | --- | --- | --- |
| b01 | 1.1 | 22 | 15 | 3 | 4 | 0 | 22 |
| b02 | 1.2, 1.12 | 34 | 25 | 3 | 6 | 0 | 34 |
| b03 | 1.3, 1.4 | 38 | 34 | 2 | 2 | 0 | 38 |
| b04 | 1.5 | 21 | 15 | 0 | 6 | 0 | 21 |
| b05 | 1.6 | 39 | 31 | 4 | 4 | 0 | 39 |
| b06 | 1.7, 1.10 | 28 | 21 | 2 | 5 | 0 | 28 |
| b07 | 1.8, 1.9 | 40 | 32 | 2 | 6 | 0 | 40 |
| b08 | 1.11 | 20 | 3 | 3 | 14 | 0 | 20 |
| b09 | 1.13 | 29 | 25 | 1 | 3 | 0 | 29 |
| b10 | 2.1 | 39 | 36 | 1 | 1 | 1 | 38 |
| b11 | 2.2 | 36 | 32 | 2 | 2 | 0 | 36 |
| b12 | 2.3 | 24 | 22 | 1 | 1 | 0 | 24 |
| b13 | 2.4 | 32 | 28 | 2 | 2 | 0 | 32 |
| b14 | 2.5 | 22 | 18 | 1 | 3 | 0 | 22 |
| b15 | 2.5 | 21 | 15 | 4 | 1 | 1 | 20 |
| b16 | 2.6 | 24 | 17 | 1 | 6 | 0 | 24 |
| b17 | 2.7, 2.8 | 38 | 31 | 3 | 4 | 0 | 38 |
| b18 | 2.9 | 21 | 15 | 0 | 5 | 1 | 20 |
| b19 | 3.1 | 34 | 28 | 2 | 4 | 0 | 34 |
| b20 | 3.1 | 33 | 22 | 3 | 2 | 6 | 27 |
| b21 | 3.2 | 30 | 27 | 0 | 3 | 0 | 30 |
| b22 | 3.2 | 29 | 26 | 1 | 1 | 1 | 28 |
| b23 | 3.3 | 40 | 30 | 2 | 8 | 0 | 40 |
| b24 | 3.3 | 39 | 34 | 0 | 4 | 1 | 38 |
| b25 | 3.4 | 30 | 26 | 1 | 3 | 0 | 30 |
| b26 | 3.4 | 30 | 23 | 3 | 3 | 1 | 29 |
| b27 | 3.4 | 30 | 25 | 0 | 5 | 0 | 30 |
| b28 | 3.5 | 40 | 37 | 2 | 1 | 0 | 40 |
| b29 | 4.1 | 20 | 16 | 0 | 4 | 0 | 20 |
| b30 | 4.2, 4.5 | 28 | 23 | 2 | 3 | 0 | 28 |
| b31 | 4.3, 4.6 | 25 | 20 | 2 | 2 | 1 | 24 |
| b32 | 4.4, 4.8 | 26 | 20 | 3 | 1 | 2 | 24 |
| b33 | 4.7, 4.9 | 27 | 22 | 0 | 3 | 2 | 25 |
| b34 | 5.1, 5.2 | 33 | 26 | 0 | 6 | 1 | 32 |
| b35 | 5.3, 5.4 | 36 | 33 | 0 | 3 | 0 | 36 |
| b36 | 5.5, 5.8 | 34 | 31 | 3 | 0 | 0 | 34 |
| b37 | 5.6 | 33 | 0 | 0 | 33 | 0 | 33 |
| b38 | 5.7 | 29 | 24 | 1 | 3 | 1 | 28 |
| b39 | 5.9, 5.10 | 27 | 21 | 2 | 2 | 2 | 25 |
| b40 | 6.1, 6.4 | 30 | 9 | 1 | 19 | 1 | 29 |
| b41 | 6.2, 6.3 | 37 | 18 | 2 | 5 | 12 | 25 |
| b42 | 6.5 | 22 | 0 | 2 | 14 | 6 | 16 |
| b43 | 6.6, 6.7 | 38 | 29 | 3 | 5 | 1 | 37 |
| b44 | 4.3, 4.4, 4.6, 4.8, 5.10 | 16 | 9 | 0 | 5 | 2 | 14 |
| b45 | 6.1, 6.2, 6.3, 6.4, 6.5, 6.6 | 22 | 15 | 1 | 5 | 1 | 21 |
