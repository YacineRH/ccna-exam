# Journal des relectures du bloc 7 (CompTIA Security+ SY0-701)

Banque Security+ portée de 0 à 928 questions : 978 questions rédigées en 34 lots (33 lots du plan, puis un lot de complément pour l'équilibre des pondérations), chacune relue par un agent distinct qui n'avait vu ni la rédaction ni ses échanges. Consignes : `consigne-redaction.md`, `consigne-relecture.md`, `consigne-echantillon.md` et leur annexe `annexe-security-plus.md`. Toutes les questions publiées portent `source: "ai"`. Les journaux question par question sont dans `relectures-security-plus/` (un fichier par lot) et `echantillon-security-plus/`.

## Bilan

| | Questions | Part |
| --- | --- | --- |
| Rédigées | 978 | 100 % |
| Gardées telles quelles | 723 | 73,9 % |
| Corrigées sur le fond (réponse défendable, valeur fausse, distracteur défendable, explication fausse, exhibit incohérent, référence douteuse) | 38 | 3,9 % |
| Corrigées sur la forme (indice de longueur ou de mot repris, options non parallèles, formulation, difficulté, forme de réponse manquante) | 170 | 17,4 % |
| Rejetées (doublons pour la plupart) | 47 | 4,8 % |
| Publiées après relecture | 931 | |
| Retirées ensuite (voir « Après publication ») | 3 | |
| **Dans la banque** | **928** | |

**Ce que les relectures ont le plus trouvé.** (1) Des **doublons** entre lots : plusieurs lots couvrent des notions voisines (SLA, ordre de volatilité RFC 3227, phases NIST SP 800-61, SOC 2 type II, CVSS, segmentation d'un équipement non patchable) ; le relecteur compare chaque question à la banque déjà publiée et à l'autre lot du même sous-thème. (2) Des **indices** : bonne réponse nettement plus longue, ou seule à reprendre un mot de l'énoncé. (3) Des **exhibits incohérents** (nombre d'échecs qui ne colle pas avec l'intervalle, jour de la semaine faux pour une date, événement Windows impossible sur le poste cité). (4) Des **explications trop absolues** ou une affirmation fausse dans une note (TLS 1.3 « n'autorise que (EC)DHE » alors que le mode PSK seul n'en utilise pas ; SAST « impossible sans code source » ; scan ASV présenté comme « une exigence parmi douze »). (5) Des **références** : un numéro de section ou d'identifiant douteux est retiré plutôt que gardé (RFC 3227 section, PCI DSS 3.3.1, versions de NIST SP 800-63B, SP 800-88 et SP 800-50 précisées).

## Contrôle d'échantillon

5 % des questions publiées de chaque lot, **au moins une par lot** (seed 20261108, `packages/content/scripts/sample-batch.mjs`, tirage dans `echantillon-security-plus/tirage.json`), relues par quatre agents de troisième passe qui ne connaissaient ni la rédaction ni la relecture : 64 questions lues (6,9 % de la banque, à cause de l'arrondi par lot).

| Domaine | Questions relues | Erreurs de fond | Défauts de forme |
| --- | --- | --- | --- |
| 1.0 | 7 | 0 | 0 |
| 2.0 | 16 | 0 | 3 |
| 3.0 | 11 | 0 | 0 |
| 4.0 | 17 | 0 | 1 |
| 5.0 | 13 | 0 | 1 |
| **Total** | **64** | **0 (0 %)** | **5** |

Aucun lot ne dépasse le seuil de 2 % d'erreurs de fond : **aucune relecture complète n'a été relancée.** Les cinq défauts de forme ont tous été traités :

| Question | Défaut | Traitement |
| --- | --- | --- |
| `2.2-point-eau-journal-proxy-001` | faute dans l'exhibit (« annee ») | corrigée |
| `2.2-im-external-federation-001` | « trois partenaires » repris par la seule bonne option | énoncé et option reformulés |
| `5.5-audit-committee-independence-001` | « conseil d'administration » repris par la seule bonne option | énoncé reformulé |
| `4.1-wifi-site-survey-order-001` | ordonnancement sur une séquence non normée (l'annexe les limite aux séquences normées) | **retirée** |
| `2.5-server-decommission-steps` | quasi-doublon de `4.2-server-decommission-order-001` (même scénario, mêmes étapes) | **retirée** |

## Après publication

Trois questions ont été retirées de la banque après leur publication, en plus des rejets de relecture : `4.6-ldaps-port-001` (paire suspecte, score 0,64, avec `4.5-ldaps-port-001` : même question à compléter, même réponse 636), et les deux de l'échantillon ci-dessus. La série est assemblée avec la banque finale.

## Par lot

| Lot | Sous-thèmes | Rédigées | ok | Corrigées (fond) | Corrigées (forme) | Rejetées | Publiées |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s01 | 1.1 | 22 | 17 | 1 | 3 | 1 | 21 |
| s02 | 1.2 | 36 | 32 | 0 | 4 | 0 | 36 |
| s03 | 1.3 | 20 | 16 | 0 | 4 | 0 | 20 |
| s04 | 1.4 | 40 | 34 | 2 | 4 | 0 | 40 |
| s05 | 2.1 | 30 | 28 | 1 | 0 | 1 | 29 |
| s06 | 2.2 | 22 | 0 | 0 | 21 | 1 | 21 |
| s07 | 2.2 | 22 | 15 | 0 | 6 | 1 | 21 |
| s08 | 2.3 | 24 | 14 | 2 | 8 | 0 | 24 |
| s09 | 2.3 | 24 | 17 | 3 | 1 | 3 | 21 |
| s10 | 2.4 | 25 | 20 | 2 | 3 | 0 | 25 |
| s11 | 2.4 | 25 | 16 | 1 | 5 | 3 | 22 |
| s12 | 2.5 | 40 | 31 | 0 | 9 | 0 | 39 |
| s13 | 3.1 | 22 | 19 | 0 | 3 | 0 | 22 |
| s14 | 3.1 | 22 | 16 | 0 | 3 | 3 | 19 |
| s15 | 3.2 | 25 | 20 | 0 | 5 | 0 | 25 |
| s16 | 3.2 | 25 | 17 | 0 | 8 | 0 | 25 |
| s17 | 3.3 | 38 | 32 | 0 | 6 | 0 | 38 |
| s18 | 3.4 | 38 | 32 | 1 | 5 | 0 | 38 |
| s19 | 4.1 | 32 | 21 | 2 | 3 | 6 | 25 |
| s20 | 4.2, 4.7 | 38 | 29 | 4 | 5 | 0 | 38 |
| s21 | 4.3 | 34 | 23 | 4 | 2 | 5 | 29 |
| s22 | 4.4 | 32 | 23 | 3 | 3 | 3 | 29 |
| s23 | 4.5 | 36 | 27 | 0 | 9 | 0 | 36 |
| s24 | 4.6 | 40 | 36 | 1 | 3 | 0 | 39 |
| s25 | 4.8 | 30 | 19 | 4 | 4 | 3 | 27 |
| s26 | 4.9 | 24 | 14 | 0 | 7 | 3 | 21 |
| s27 | 5.1 | 36 | 27 | 4 | 5 | 0 | 36 |
| s28 | 5.2 | 22 | 17 | 0 | 1 | 4 | 18 |
| s29 | 5.2 | 22 | 16 | 0 | 6 | 0 | 22 |
| s30 | 5.3 | 28 | 21 | 0 | 3 | 4 | 24 |
| s31 | 5.4 | 30 | 25 | 1 | 3 | 1 | 29 |
| s32 | 5.5 | 26 | 21 | 0 | 4 | 1 | 25 |
| s33 | 5.6 | 28 | 18 | 2 | 7 | 1 | 27 |
| s34 | 4.1, 4.3, 4.4, 4.9 | 20 | 10 | 0 | 7 | 3 | 17 |
| **Total** | | **978** | 723 | 38 | 170 | 47 | **928** |

Les « publiées » tiennent compte des retraits après publication (s12, s19, s24).

## Incidents du processus

- **Lot s08** : le premier agent de rédaction a été arrêté par un filtre de sécurité automatique, avant d'écrire quoi que ce soit, sur les angles « lire un extrait de code vulnérable ». Les angles ont été redéfinis du côté de la défense (classer une vulnérabilité décrite en mots, contre-mesures, rapports d'analyse) et la règle est devenue celle de l'annexe : aucun code d'exploitation, aucune charge utile, aucune procédure d'attaque. Le lot a été réécrit et relu normalement.
- **Doublons rejetés des deux côtés** : quand deux lots partagent un sous-thème (2.2, 2.3, 2.4, 3.1, 3.2, 5.2) et sont relus en parallèle, chaque relecteur pouvait rejeter la même question chez l'autre. Pour s10 et s11 (3 doublons) et s08 et s09 (1 doublon), des questions rejetées par les deux relecteurs ont été **restaurées** dans un seul lot (journal annoté) ; pour les lots suivants, la règle « le lot au numéro le plus élevé retire sa question » a été donnée aux relecteurs.
- **Limite d'usage** : huit relectures et une rédaction ont été interrompues par une limite d'usage de l'API. Les trois relectures (s20, s24, s32) dont le journal question par question et le lot relu étaient complets (journal = toutes les questions du brouillon ; modifications du lot relu = corrections annoncées) ont été publiées ; les six autres agents ont été relancés par message et ont terminé leur travail à partir de leur transcription. Rien n'a été publié sans relecture.
- **Lots sous la répartition du brief** : les rejets (doublons surtout) font que plusieurs lots n'ont pas exactement leur répartition par type et par difficulté. Les cibles de la banque entière (types, 30/50/20, pondérations, sous-thèmes) sont tenues, et un lot de complément (s34, 4.0) a rétabli la pondération du domaine 4.0 après les rejets.
