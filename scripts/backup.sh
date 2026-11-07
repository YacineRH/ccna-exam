#!/usr/bin/env sh
# Sauvegarde de la base ExamForge, à lancer par cron sur le VPS :
#   15 3 * * * /srv/examforge/scripts/backup.sh >> /var/log/examforge-backup.log 2>&1
# Garde les sauvegardes des 14 derniers jours.
set -eu
cd "$(dirname "$0")/.."
DEST="${BACKUP_DIR:-/var/backups/examforge}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$DEST"
FILE="$DEST/examforge-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U examforge --no-owner --clean --if-exists examforge | gzip > "$FILE"
# Une sauvegarde vide signale un problème : on échoue bruyamment.
[ "$(gzip -dc "$FILE" | head -c 1 | wc -c)" -eq 1 ] || { echo "Sauvegarde vide : $FILE" >&2; rm -f "$FILE"; exit 1; }
find "$DEST" -name 'examforge-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "OK $FILE"
