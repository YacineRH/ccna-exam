# Déploiement sur le VPS OVH

ExamForge tourne sur le même VPS qu'Hydre, **à côté** et non dedans : conteneurs, base, volumes et réseau Docker propres. Seul un port local (`127.0.0.1:8080`) est exposé. Le reverse proxy déjà en place sur le VPS fait le HTTPS et relaie `ccna.<ton-domaine>` vers ce port.

## 1. DNS chez OVH

Dans l'espace client OVH > Domaines > Zone DNS, ajouter :

| Type | Sous-domaine | Cible |
| --- | --- | --- |
| A | `ccna` | IPv4 du VPS |
| AAAA | `ccna` | IPv6 du VPS (si le VPS en a une) |

## 2. Première installation

```sh
sudo mkdir -p /srv/examforge && sudo chown "$USER" /srv/examforge
git clone git@github.com:yacinerh/ccna-exam.git /srv/examforge
cd /srv/examforge
cp .env.example .env
# Remplir .env : générer chaque secret avec `openssl rand -base64 48`
docker compose up -d --build
docker compose logs -f api   # attendre "Server listening"
curl -s http://127.0.0.1:8080/api/v1/health
```

Ouvrir ensuite `https://ccna.<ton-domaine>` et créer le compte : **le premier compte créé devient administrateur**, et les inscriptions se ferment ensuite (sauf si `ALLOW_REGISTRATION=true`).

## 3. Brancher le reverse proxy existant

Utiliser le bloc qui correspond au reverse proxy d'Hydre.

**Caddy**

```caddy
ccna.ton-domaine.fr {
	reverse_proxy 127.0.0.1:8080
}
```

**Nginx** (certificat via certbot)

```nginx
server {
    server_name ccna.ton-domaine.fr;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    listen 443 ssl http2;
    # lignes ssl_certificate ajoutées par certbot --nginx
}
```

**Traefik** : le plus simple est d'ajouter le service `web` au réseau de Traefik avec les labels habituels (`traefik.http.routers.examforge.rule=Host(\`ccna.ton-domaine.fr\`)`), et de retirer la ligne `ports` de `docker-compose.yml`.

## 4. Sauvegardes

```sh
sudo crontab -e
# Sauvegarde quotidienne à 3h15, conservée 14 jours
15 3 * * * /srv/examforge/scripts/backup.sh >> /var/log/examforge-backup.log 2>&1
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
   - Variables : `DEPLOY_ENABLED=true`, `DEPLOY_PATH=/srv/examforge`, `PUBLIC_URL=https://ccna.ton-domaine.fr`.
3. Créer l'environnement `production` (Settings > Environments) pour pouvoir y ajouter une validation manuelle si besoin.

Le workflow se connecte en SSH, se place sur le commit testé, reconstruit les images, redémarre les conteneurs puis vérifie `/api/v1/health`.

## 6. Ressources

Les conteneurs sont plafonnés : 512 Mo pour PostgreSQL, 384 Mo pour l'API, 128 Mo pour le web. Vérifier la marge restante à côté d'Hydre avec `docker stats` et `free -h`.

## Mise à jour manuelle

```sh
cd /srv/examforge && git pull && docker compose up -d --build
```

Les migrations de base s'appliquent toutes seules au démarrage de l'API.
