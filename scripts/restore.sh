#!/usr/bin/env sh
# Restaure une sauvegarde : ./scripts/restore.sh /var/backups/examforge/examforge-AAAAMMJJ-HHMMSS.sql.gz
set -eu
[ $# -eq 1 ] || { echo "usage: $0 <fichier.sql.gz>" >&2; exit 2; }
cd "$(dirname "$0")/.."
gzip -dc "$1" | docker compose exec -T db psql -U examforge -v ON_ERROR_STOP=1 examforge
echo "Restauration terminée depuis $1"
