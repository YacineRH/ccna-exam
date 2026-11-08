# Annexe Security+ (SY0-701) aux consignes de rédaction, de relecture et d'échantillon

Cette annexe complète `consigne-redaction.md`, `consigne-relecture.md` et `consigne-echantillon.md` pour la certification `security-plus` (CompTIA Security+ SY0-701). En cas de conflit, elle l'emporte sur les règles propres au CCNA (IOS, CLI, subnetting).

## 1. Ce qui change

| Point | CCNA | Security+ |
| --- | --- | --- |
| Code de certification | `ccna` | `security-plus` |
| Slug | `ccna-<sous-thème>-<sujet>-<NNN>` | `security-plus-<sous-thème>-<sujet>-<NNN>`, ex. `security-plus-2.4-password-spraying-log-001` |
| Contexte de la banque | `batch-context.mjs 3.4` | `batch-context.mjs 2.4 --cert security-plus --full` |
| Contrôle | `check-batch.mjs lot.json --subtopics 3.4` | `check-batch.mjs lot.json --subtopics 2.4 --cert security-plus` |
| Types | les six | `mcq_single`, `mcq_multi`, `matching`, `ordering`, `fill_blank` ; **jamais `cli`** |
| Programme | 200-301 v1.1 | objectifs officiels SY0-701 (version 5.0 du document d'objectifs CompTIA) |

## 2. Style : des scénarios, pas du rappel pur

La Security+ évalue le jugement en situation. Une question type commence par un contexte concret :

- « Un analyste du SOC constate dans le SIEM… », « Une PME de 40 salariés veut… », « Lors d'un test d'intrusion en boîte grise, l'équipe… », « Le RSSI doit choisir… ».
- Le candidat **choisit l'action, le contrôle, l'outil ou le diagnostic le plus adapté** (« Quelle mesure l'analyste doit-il prendre EN PREMIER ? », « Quel contrôle répond le mieux à l'exigence ? »).
- Au moins **70 %** des questions d'un lot sont des scénarios. Les questions `easy` restent ancrées dans une situation courte (une phrase de contexte) même quand elles vérifient une définition.
- **Exhibits** : extraits de journaux (authentification Windows 4625/4624, journaux Linux `auth.log`, journaux de pare-feu, de proxy, d'accès web Apache/Nginx, requêtes DNS), règles de pare-feu, alertes de SIEM, sorties `nmap`, en-têtes de courriel (`Received:`, `Authentication-Results:` SPF/DKIM/DMARC), vecteurs CVSS, extraits de politique, registres de risques. Réalistes, cohérents avec l'énoncé (mêmes adresses, mêmes noms, mêmes heures), 80 caractères par ligne au plus. Adresses de documentation uniquement : `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`, plages privées RFC 1918, domaines `example.com`, `example.org`, `example.net`.
- **Point de vue du défenseur.** Les questions décrivent les attaques et les vulnérabilités par leurs indicateurs, leur classification et leurs atténuations, au niveau conceptuel de la Security+. Aucun code d'exploitation, aucune charge utile complète, aucune procédure pas à pas d'attaque ; un journal peut montrer la trace d'une tentative (une ligne d'accès web tronquée, un échec d'authentification répété), jamais un mode d'emploi.
- **« EN PREMIER », « LE MIEUX », « LE PLUS probable »** : ces formulations exigent qu'une seule option soit défendable comme meilleure, au regard d'un référentiel (ordre du processus NIST SP 800-61, ordre de volatilité RFC 3227, hiérarchie des contrôles). Si deux options se défendent, reformuler ou changer de question.

## 3. Références admises (aucune référence inventée)

La référence cite un document **qui existe et traite du sujet**. La liste ci-dessous n'est pas limitative : une autre RFC ou norme réelle et précise (RFC 8907 pour TACACS+, RFC 2866 pour la comptabilité RADIUS) vaut mieux que le seul document d'objectifs. Un numéro de section, de contrôle ou de technique n'est donné que si l'on en est certain ; sinon le document seul.

| Sujet | Références sûres |
| --- | --- |
| Programme | CompTIA Security+ SY0-701 Exam Objectives (objectif 1.1 à 5.6) |
| Réponse aux incidents | NIST SP 800-61 Rev. 2 (préparation ; détection et analyse ; confinement, éradication et reprise ; activité post-incident) — la Rev. 3 (2025) s'aligne sur le CSF 2.0 |
| Ordre de volatilité, collecte de preuves | RFC 3227 |
| Zero Trust | NIST SP 800-207 |
| Identité, mots de passe, authentificateurs | NIST SP 800-63B ; fédération : NIST SP 800-63C |
| Gestion des risques | NIST SP 800-30 Rev. 1 (évaluation), NIST SP 800-37 Rev. 2 (RMF), NIST SP 800-39 |
| Contrôles | NIST SP 800-53 Rev. 5 (familles AC, AU, IR, CP…), ISO/IEC 27001:2022 (SMSI), ISO/IEC 27002:2022 (93 mesures en 4 thèmes : organisationnelles, humaines, physiques, technologiques) |
| Continuité | NIST SP 800-34 Rev. 1, ISO 22301 |
| Effacement des supports | NIST SP 800-88 Rev. 1 (clear, purge, destroy) |
| Journalisation | NIST SP 800-92 |
| Correctifs | NIST SP 800-40 Rev. 4 |
| Cryptographie | NIST FIPS 197 (AES), FIPS 180-4 (SHA-2), FIPS 186-5 (signatures), FIPS 140-3 (modules), NIST SP 800-57 (gestion des clés), RFC 8446 (TLS 1.3), RFC 5280 (X.509, CRL), RFC 6960 (OCSP), RFC 2104 (HMAC) |
| Cadre | NIST Cybersecurity Framework 2.0 (fonctions Govern, Identify, Protect, Detect, Respond, Recover) |
| Courriel | RFC 7208 (SPF), RFC 6376 (DKIM), RFC 7489 (DMARC) |
| Authentification réseau | IEEE 802.1X-2020, RFC 3748 (EAP), RFC 2865 (RADIUS), RFC 4511 (LDAP), RFC 6749 (OAuth 2.0), OASIS SAML 2.0, OpenID Connect Core 1.0 |
| Vulnérabilités | FIRST CVSS v3.1 Specification (et v4.0), MITRE CVE, MITRE CWE, OWASP Top 10 (2021) |
| Tactiques adverses | MITRE ATT&CK (identifiant de technique, ex. T1110.003 Password Spraying, seulement si certain) |
| Benchmarks | CIS Benchmarks, CIS Critical Security Controls v8 |
| Conformité | RGPD (règlement (UE) 2016/679, article cité seulement si certain), PCI DSS v4.0, HIPAA Security Rule, SOX, AICPA SOC 2 (type I, type II) |
| Wi-Fi | Wi-Fi Alliance WPA3 Specification, IEEE 802.11i |

Faits à vérifier deux fois (erreurs classiques) : CVSS v3.1 qualitatif (0,0 aucune ; 0,1–3,9 faible ; 4,0–6,9 moyenne ; 7,0–8,9 élevée ; 9,0–10,0 critique) ; ports (SSH 22, DNS 53, Kerberos 88, LDAP 389, HTTPS 443, SMTPS 465, SMTP soumission 587, syslog 514/UDP, LDAPS 636, IMAPS 993, POP3S 995, RDP 3389, RADIUS 1812/1813) ; SLE = AV × EF, ALE = SLE × ARO ; sauvegarde différentielle = depuis la dernière complète, incrémentielle = depuis la dernière sauvegarde quelle qu'elle soit ; RPO = perte de données tolérée, RTO = durée d'interruption tolérée ; n(n−1)/2 clés symétriques ; MAC = étiquettes imposées par le système, DAC = le propriétaire décide.

## 4. Types de questions

Mêmes formats que la consigne de rédaction, sans `cli`.

- `fill_blank` : valeurs calculées ou exactes, sans ambiguïté d'écriture. `int` pour un nombre (ALE en euros sans séparateur ni symbole, port, nombre de clés, taille de hachage en bits, heures de RPO) ; `text` pour un terme ou un nombre décimal, en listant toutes les écritures (`["9.8", "9,8"]`, `["SPF", "Sender Policy Framework"]`). Le libellé précise l'unité et le format (« en euros, nombre entier », « en heures »). Pas de `ipv4` sauf adresse réellement demandée.
- `ordering` : seulement des séquences normées et sans ambiguïté (phases NIST SP 800-61, ordre de volatilité RFC 3227, étapes d'un changement, phases d'un test d'intrusion, chaîne de traçabilité, cycle de gestion des vulnérabilités).
- `matching` : contrôle → type ou catégorie, attaque → indicateur, accord → finalité, rôle → responsabilité, algorithme → usage. Plusieurs éléments de gauche peuvent viser le même élément de droite.

## 5. Grille de relecture : points propres à la Security+

1. La réponse est celle qu'attend **CompTIA** pour SY0-701 et elle est vraie dans les référentiels cités ; quand la terminologie CompTIA diffère d'un référentiel (types de contrôles, ordre des étapes), l'énoncé le précise ou la question est reformulée pour lever le doute.
2. « EN PREMIER » / « LE MIEUX » : une seule option défendable ; les notes expliquent pourquoi chaque autre option vient après ou convient moins.
3. Aucun distracteur qui serait juste dans une autre lecture du scénario (ex. « isoler l'hôte » et « débrancher l'hôte » ensemble).
4. Les calculs (ALE, SLE, ARO, RPO, CVSS, nombre de clés) sont refaits.
5. Les références existent et portent sur le sujet ; une section ou un identifiant ATT&CK douteux est retiré.
6. Exhibits : formats de journaux plausibles (identifiants d'événement Windows exacts : 4624 succès, 4625 échec, 4720 création de compte, 4672 privilèges spéciaux, 1102 effacement du journal), adresses de documentation, horodatages cohérents.
