# Publier ExamForge derrière le Caddy d'Hydre

Sur le VPS OVH, le conteneur Caddy d'Hydre est le seul à écouter sur les ports 80 et 443 : il fait le HTTPS de `hydre.yratech.fr`. ExamForge passe derrière lui, sur `ccna.yratech.fr`, via un réseau Docker partagé nommé `edge`.

```
Internet ─▶ Caddy d'Hydre (80/443, Let's Encrypt)
              ├─ hydre.yratech.fr ─▶ backend d'Hydre      (réseau interne d'Hydre)
              └─ ccna.yratech.fr  ─▶ examforge-web:80     (réseau « edge »)
                                        └─▶ api ─▶ db      (réseau interne d'ExamForge)
```

Les deux projets gardent leur base, leurs volumes et leur réseau interne propres : seul le service `web` d'ExamForge est joignable par le Caddy d'Hydre.

## Modification à apporter au dépôt Hydre

Préparée, validée (`caddy validate`, `docker compose config`, simulation du `git stash` d'OVH) et documentée dans la pull request [YacineRH/hydre#14](https://github.com/YacineRH/hydre/pull/14), branche `feat/examforge-edge`. Pour mémoire, elle contient trois changements, sans effet sur Hydre tant que `caddy-sites/` ne contient aucun fichier `.caddy` :

**1. `Caddyfile`** : ajouter à la fin

```caddy
# Sites supplémentaires hébergés sur le même VPS (ex. ExamForge sur ccna.yratech.fr).
# Un fichier .caddy par site dans ./caddy-sites ; aucun fichier = aucun effet.
import /etc/caddy/sites/*.caddy
```

**2. `docker-compose.yml`**, service `caddy` :

```yaml
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy-sites:/etc/caddy/sites:ro      # nouveau
      # … volumes existants inchangés
    networks: [internal, edge]                  # était : [internal]
```

et en bas du fichier :

```yaml
networks:
  internal:
  edge:          # nouveau : réseau partagé avec les projets publiés par Caddy
    name: edge
```

**3. Créer `caddy-sites/ccna.caddy`** avec le contenu de [`ccna.caddy`](ccna.caddy).

## Mise en route sur le VPS

```sh
# DNS OVH : enregistrement A  ccna.yratech.fr → IP du VPS (même IP qu'Hydre)

# Hydre (après merge de la PR) : garder la modification locale « tls internal » d'OVH
cd ~/hydre && cp Caddyfile ~/Caddyfile.ovh.bak && git stash && git pull origin main && git stash pop && ./scripts/deploy.sh
cd ~/examforge && docker compose up -d --build
curl -s http://127.0.0.1:8080/api/v1/health # {"status":"ok"}
```

Puis ouvrir `https://ccna.yratech.fr` : Caddy obtient le certificat au premier accès. Le premier compte créé devient administrateur.
