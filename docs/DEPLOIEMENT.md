# Déploiement sur le VPS OVH

ExamForge tourne sur le même VPS qu'Hydre, **à côté** et non dedans : conteneurs, base, volumes et réseau interne propres. Le Caddy d'Hydre, seul à écouter sur 80/443, fait le HTTPS de `ccna.yratech.fr` et relaie vers ExamForge par le réseau Docker partagé `edge`. Le détail et la modification à apporter à Hydre sont dans [`infra/hydre/README.md`](../infra/hydre/README.md).

## 0. Sur un serveur du réseau local (test avant OVH)

Pour essayer ExamForge sur une VM du réseau local, sans le Caddy d'Hydre devant ni HTTPS :

```sh
git clone https://github.com/YacineRH/ccna-exam.git ~/examforge
cd ~/examforge
git switch main                                # le bloc 7 (Security+) est fusionné ; une branche de PR pour tester avant fusion
cp .env.example .env
nano .env
```

Dans `.env` :

- `POSTGRES_PASSWORD`, `JWT_SECRET` et `SERVICE_TOKEN` : une valeur différente pour chacun, générée avec `openssl rand -base64 48` ;
- `BIND_IP=192.168.1.125` (IP du serveur) et `HTTP_PORT=8090` : Hydre garde 80/443 sur la même IP, ExamForge écoute sur 8090 ;
- `COOKIE_SECURE=false` : sans HTTPS, le navigateur refuserait sinon le cookie de session et la connexion échouerait.

Puis :

```sh
docker network inspect edge >/dev/null 2>&1 || docker network create edge   # réseau attendu par le compose
docker compose up -d --build
docker compose ps                                  # db, api et web « running »
curl -s http://192.168.1.125:8090/api/v1/health    # {"status":"ok"}
```

Ouvrir `http://192.168.1.125:8090` depuis un poste du réseau et créer le compte (le premier devient administrateur).

`COOKIE_SECURE=false` est réservé au réseau local : ne jamais l'utiliser sur un serveur joignable depuis Internet. Si la VM fait aussi tourner Hydre avec la branche `feat/examforge-edge`, on peut à la place passer par son Caddy en HTTPS (`tls internal`) avec un fichier `caddy-sites/ccna.caddy` adapté au nom local, et garder `COOKIE_SECURE=true`.

**Premier démarrage : patientez avant d'ouvrir la page.** L'API n'écoute qu'une fois les migrations appliquées et le contenu importé (banque et série des deux certifications). Mesuré sur un poste de développement : **13 à 16 s**, pour un pic de 167 à 198 Mo de mémoire (limite du conteneur : 384 Mo) ; une VM plus lente peut y mettre plus longtemps. Pendant ce temps, la page de connexion affiche « API injoignable, erreur 502 » : attendez que `docker compose logs api` montre la ligne `security-plus : 30 examens blancs (…)` puis cliquez sur « Réessayer ». Si le 502 dure plus de deux minutes, `docker compose ps` (l'API redémarre-t-elle en boucle ?) et `docker compose logs --tail 80 api` donnent la cause. Les démarrages suivants parcourent les mêmes fichiers mais n'écrivent presque rien.

La mise à niveau d'une base existante (ancienne version vers le bloc 7) a été essayée en local : la migration `0003` s'applique (3 puis 4 migrations), le CCNA et un examen déjà passé restent intacts, la Security+ est importée.

### Joindre la VM par Tailscale

Pour atteindre la VM de test depuis vos appareils sans ouvrir de port ni dépendre du réseau local, un conteneur Tailscale rejoint votre tailnet et publie le service web en HTTPS (`tailscale serve`). **Pas de Funnel** : rien n'est exposé à Internet, seuls les appareils de votre tailnet voient `https://examforge.<nom-du-tailnet>.ts.net`.

Une fois, dans la console d'administration Tailscale :

1. activer **MagicDNS** et **HTTPS Certificates** (page DNS) : sans eux, `serve` ne peut pas obtenir de certificat ;
2. créer une **clé d'authentification** (Settings, Keys). Une clé à usage unique suffit : l'état de la machine est gardé dans un volume, la clé ne sert qu'au premier démarrage ; avec une clé « éphémère », la machine est retirée automatiquement du tailnet peu après l'arrêt du conteneur.

Sur la VM, dans `.env` (jamais commité) :

```sh
TS_AUTHKEY=tskey-auth-…
COMPOSE_FILE=docker-compose.yml:docker-compose.tailscale.yml
# TS_HOSTNAME=examforge          # nom de la machine dans le tailnet (par défaut : examforge)
```

Puis, comme d'habitude :

```sh
docker compose up -d --build
docker compose logs tailscale | tail            # « Serve: https://examforge.<tailnet>.ts.net »
```

Ouvrir l'adresse `https://examforge.<tailnet>.ts.net` depuis un appareil du tailnet. L'accès local `http://192.168.1.125:8090` continue de fonctionner. Sans `COMPOSE_FILE`, la commande équivalente est `docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d --build`.

Détails à connaître :

- **Fichiers** : `docker-compose.tailscale.yml` (service `tailscale`, réseau en espace utilisateur : ni `/dev/net/tun` ni `NET_ADMIN`, donc aucun privilège sur la VM) et `infra/tailscale/serve.json` (HTTPS 443 vers `http://web:80`, `${TS_CERT_DOMAIN}` remplacé par Tailscale). Sans le deuxième fichier, rien ne change : le compose de base n'a pas de service Tailscale.
- **Cookie de session** : `COOKIE_SECURE=false` (déjà utilisé pour le réseau local) fonctionne aussi en HTTPS ; on peut le remettre à `true` si la VM n'est plus jointe qu'en HTTPS par Tailscale.
- **Limite de connexions** : l'API limite les connexions à 5 essais par minute et par adresse ; les requêtes venant de Tailscale lui arrivent du conteneur Tailscale, donc de la même adresse pour tous les appareils (sans effet pour un usage personnel).
- **Arrêter** : `docker compose stop tailscale`. Pour retirer définitivement la machine : la supprimer dans la console Tailscale, puis `docker compose rm -f tailscale && docker volume rm examforge_tailscale-state` (ce volume contient l'identité de la machine : un nouveau démarrage demandera une nouvelle clé).
- **Non testé ici** : la validité des fichiers compose et JSON est vérifiée (`docker compose config`), mais le conteneur Tailscale lui-même n'a pas été démarré (pas de clé ni d'accès au tailnet depuis l'environnement où il a été écrit) : premier essai à faire sur la VM.

## 1. DNS chez OVH

Dans l'espace client OVH > Domaines > yratech.fr > Zone DNS, ajouter :

| Type | Sous-domaine | Cible |
| --- | --- | --- |
| A | `ccna` | IPv4 du VPS (la même que `hydre`) |
| AAAA | `ccna` | IPv6 du VPS (si `hydre` en a une) |

## 2. Brancher le Caddy d'Hydre

Merger la pull request [YacineRH/hydre#14](https://github.com/YacineRH/hydre/pull/14) (réseau `edge`, import de `caddy-sites/*.caddy`, fichier `ccna.caddy` ; détails dans [`infra/hydre/README.md`](../infra/hydre/README.md)), puis sur OVH, en gardant la modification locale « tls internal » :

```sh
cd ~/hydre && cp Caddyfile ~/Caddyfile.ovh.bak && git stash && git pull origin main && git stash pop && ./scripts/deploy.sh
```

## 3. Première installation d'ExamForge

```sh
git clone git@github.com:YacineRH/ccna-exam.git ~/examforge
cd ~/examforge
cp .env.example .env
# Remplir .env : générer chaque secret avec `openssl rand -base64 48`
docker compose up -d --build
docker compose logs -f api   # attendre "Server listening"
curl -s http://127.0.0.1:8080/api/v1/health
```

Ouvrir ensuite `https://ccna.yratech.fr` et créer le compte : **le premier compte créé devient administrateur**, et les inscriptions se ferment ensuite (sauf si `ALLOW_REGISTRATION=true`).

## 4. Sauvegardes

```sh
sudo crontab -e
# Sauvegarde quotidienne à 3h15, conservée 14 jours
15 3 * * * /home/ubuntu/examforge/scripts/backup.sh >> /var/log/examforge-backup.log 2>&1
```

Restauration : `./scripts/restore.sh /var/backups/examforge/examforge-AAAAMMJJ-HHMMSS.sql.gz`.

Pour une copie hors du VPS, synchroniser `/var/backups/examforge` vers le homelab (rsync ou restic).

## 5. Déploiement automatique depuis GitHub

Le workflow `.github/workflows/deploy.yml` déploie après chaque CI verte sur `main`. Il reste inactif tant qu'il n'est pas configuré.

1. Sur le VPS, créer une clé réservée au déploiement et l'autoriser :
   ```sh
   ssh-keygen -t ed25519 -f ~/.ssh/examforge_deploy -N "" -C "github-deploy"
   cat ~/.ssh/examforge_deploy.pub >> ~/.ssh/authorized_keys
   ```
   L'utilisateur doit pouvoir lancer `docker compose` et lire le dépôt (clé de déploiement GitHub en lecture seule).
2. Dans GitHub > Settings > Secrets and variables > Actions :
   - Secrets : `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (contenu de la clé privée), `DEPLOY_KNOWN_HOSTS` (sortie de `ssh-keyscan <ip-du-vps>`).
   - Variables : `DEPLOY_ENABLED=true`, `DEPLOY_PATH` (chemin absolu du clone, ex. `/home/ubuntu/examforge`), `PUBLIC_URL=https://ccna.yratech.fr`.
3. Créer l'environnement `production` (Settings > Environments) pour pouvoir y ajouter une validation manuelle si besoin.

Le workflow se connecte en SSH, se place sur le commit testé, reconstruit les images, redémarre les conteneurs puis vérifie `/api/v1/health`.

## 6. Ressources

Les conteneurs sont plafonnés : 512 Mo pour PostgreSQL, 384 Mo pour l'API, 128 Mo pour le web. Vérifier la marge restante à côté d'Hydre avec `docker stats` et `free -h`.

## Contenus : banque, labs et série d'examens

**Voie retenue : l'import au démarrage depuis `packages/content`.** À chaque démarrage, l'API importe la configuration des certifications, la banque de questions (`data/questions/`), les labs et challenges (`data/labs/`) et la série d'examens blancs figés (`data/exams/<code>.json`) contenus dans son image Docker. Les contenus arrivent donc sur le VPS avec le code, par le même `git pull && docker compose up -d --build` (ou le déploiement automatique), après être passés par les mêmes tests que lui en CI.

Pourquoi pas les outils MCP sur l'API de production : ils servent à ajouter quelques questions à la volée, pas à charger 1 500 questions et 100 examens. Ils demanderaient le jeton de service hors du VPS, des milliers d'appels sans transaction d'ensemble, et un contenu de production qui ne serait plus celui du dépôt (ni revu, ni testé, ni sauvegardé par git). Avec l'import, le dépôt reste la source de vérité et la base peut être reconstruite à l'identique.

L'import est **idempotent** :
- **questions** : rangées par slug ; une question inchangée n'est pas réécrite, une question modifiée est mise à jour, une nouvelle est ajoutée ; un doublon d'énoncé est refusé (le démarrage échoue, comme les tests de contenu) ;
- **examens** : rangés par numéro ; un examen absent est créé, un examen identique (mêmes questions, même ordre) n'est pas touché. Un second import ne crée donc ni doublon ni nouvel examen ;
- **examens déjà passés** : un examen que quelqu'un a commencé **ne change jamais de contenu**. Si le fichier de la série a changé depuis (série régénérée après un ajout de questions), l'examen passé garde ses questions et son ordre, et le journal le signale : `ccna : 100 examens blancs (0 créés, 3 mis à jour, 95 inchangés, 2 déjà passés gardés tels quels : n° 12, 42)`. Seuls les examens jamais commencés suivent le nouveau fichier. Le test `apps/api/test/exams.test.ts` le vérifie.

**Deux certifications, un import.** `seedContent` parcourt toutes les certifications de `packages/content/data/certifications/` : CCNA (`ccna`) et Security+ (`security-plus`), chacune avec sa banque, sa série et, pour le CCNA, ses labs. Chaque certification est importée indépendamment (ses questions, sa série), et la règle ci-dessus s'applique à chacune : **les examens déjà passés, CCNA comme Security+, ne changent jamais**, et un second import (ou dix) ne crée ni question ni examen de plus. Le test `apps/api/test/exams.test.ts` passe l'examen n° 42 du CCNA et le n° 7 de la Security+, réimporte deux fois et compare avant/après (questions et ordre des examens, nombres de lignes par certification) ; `apps/api/test/certifications.test.ts` vérifie l'isolation (statistiques, progression, numéros d'examen). Chaque import date la certification (`certifications.last_imported_at`) et garde son résumé (`last_import`), que l'écran `/admin` affiche. La migration `0003_last_import.sql` ajoute ces deux colonnes : elle s'applique toute seule au démarrage, sans toucher aux données existantes.

Le premier démarrage avec les deux banques importe environ 2 400 questions et 12 900 places d'examen en quelques secondes ; les suivants ne font que comparer. Pour vérifier après un déploiement :

```sh
docker compose logs api | grep -E "questions|examens blancs"
curl -s https://ccna.yratech.fr/api/v1/certifications/ccna | jq '.bank.questions, .bank.exams'            # 1523, 100
curl -s https://ccna.yratech.fr/api/v1/certifications/security-plus | jq '.bank.questions, .bank.exams'     # voir le rapport de série du bloc 7, 30
```

Une question corrigée (faute, explication) est mise à jour en place : les post-mortems la montrent corrigée, sans changer la composition d'aucun examen. Une question retirée du dépôt reste en base pour l'historique.

## Mise à jour manuelle

```sh
cd ~/examforge && git pull && docker compose up -d --build
```

Les migrations de base s'appliquent toutes seules au démarrage de l'API.
