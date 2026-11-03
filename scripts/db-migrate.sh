#!/usr/bin/env bash
# Apply all incremental db/init migrations (02+) to an EXISTING database, then
# reload the PostgREST schema cache so new columns/tables are visible at once.
# Every db/init file from 02 on must be idempotent (IF NOT EXISTS / CREATE OR REPLACE).
#
# Usage: scripts/db-migrate.sh [compose-file]   (default: docker-compose.yml)
#   live: scripts/db-migrate.sh docker-compose.prod.yml
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE_FILE="${1:-docker-compose.yml}"
DB_USER="${POSTGRES_USER:-skillmark}"
DB_NAME="${POSTGRES_DB:-skillmark}"
psql_db() { docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q "$@"; }

mkdir -p "$HOME/backups"
backup="$HOME/backups/skillmark-$(date +%F-%H%M%S).sql"
docker compose -f "$COMPOSE_FILE" exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" > "$backup"
echo "Backup: $backup"

for f in $(ls db/init/*.sql | sort); do
  case "$(basename "$f")" in 00-*|01-*) continue ;; esac
  echo "Applying $(basename "$f")"
  psql_db < "$f"
done

psql_db -c "NOTIFY pgrst, 'reload schema';"
echo "Done. PostgREST schema cache reload requested."
