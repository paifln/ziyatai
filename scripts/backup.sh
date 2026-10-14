#!/bin/sh
set -eu
# BACKUP_DIRECTORY must be a mounted encrypted disk, outside the public webroot.
: "${BACKUP_DIRECTORY:?Set encrypted backup directory}"
mkdir -p "$BACKUP_DIRECTORY"
chmod 700 "$BACKUP_DIRECTORY"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f infra/compose.production.yml --env-file .env.production exec -T postgres pg_dump -U ziyatai -d ziyatai -Fc > "$BACKUP_DIRECTORY/ziyatai-$stamp.dump.tmp"
mv "$BACKUP_DIRECTORY/ziyatai-$stamp.dump.tmp" "$BACKUP_DIRECTORY/ziyatai-$stamp.dump"
chmod 600 "$BACKUP_DIRECTORY/ziyatai-$stamp.dump"
# Retention: 30 days; objects require a separate encrypted S3 backup/version policy.
find "$BACKUP_DIRECTORY" -maxdepth 1 -name 'ziyatai-*.dump' -type f -mtime +30 -delete
