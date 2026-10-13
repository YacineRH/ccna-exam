# Déploiement sur le VPS OVH

ExamForge tourne sur le même VPS qu'Hydre, **à côté** et non dedans : conteneurs, base, volumes et réseau interne propres. Le Caddy d'Hydre, seul à écouter sur 80/443, fait le HTTPS de `ccna.yratech.fr` et relaie vers ExamForge par le réseau Docker partagé `edge`. Le détail et la modification à apporter à Hydre sont dans [`infra/hydre/README.md`](../infra/hydre/README.md).

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

## Mise à jour manuelle

```sh
cd ~/examforge && git pull && docker compose up -d --build
```

Les migrations de base s'appliquent toutes seules au démarrage de l'API.
