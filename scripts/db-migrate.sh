#!/usr/bin/env bash
# Apply all incremental db/init migrations (02+) to an EXISTING database, then
# reload the PostgREST schema cache so new columns/tables are visible at once.
# Every db/init file from 02 on must be idempotent (IF NOT EXISTS / CREATE OR REPLACE).
#
# Usage: scripts/db-migrate.sh [compose-file]   (default: docker-compose.yml)
#   live: scripts/db-migrate.sh docker-compose.prod.yml
#   skip backup (CI / nested deploy): SKIP_DB_BACKUP=1 ./scripts/db-migrate.sh …
#
# Production Deploy workflow runs this automatically after `compose up`.
#
# Optional env:
#   COMPOSE_ENV_FILE       passed as --env-file
#   COMPOSE_PROJECT_NAME   passed as -p (needed for skillmark-dev)
#   SKIP_DB_BACKUP=1       skip pg_dump
#   DB_INIT_DIR            override SQL dir (default: <repo>/db/init)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
COMPOSE_FILE="${1:-docker-compose.yml}"
DB_USER="${POSTGRES_USER:-skillmark}"
DB_NAME="${POSTGRES_DB:-skillmark}"
INIT_DIR="${DB_INIT_DIR:-$ROOT/db/init}"

DC=(docker compose -f "$COMPOSE_FILE")
if [ -n "${COMPOSE_ENV_FILE:-}" ]; then
  DC+=(--env-file "$COMPOSE_ENV_FILE")
fi
if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
  DC+=(-p "$COMPOSE_PROJECT_NAME")
fi
psql_db() { "${DC[@]}" exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q "$@"; }

if [ ! -f "$COMPOSE_FILE" ] && [ ! -f "$ROOT/$COMPOSE_FILE" ]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi
if [ ! -d "$INIT_DIR" ]; then
  echo "Migration dir not found: $INIT_DIR" >&2
  exit 1
fi

# Ensure db is up (no-op if already running).
"${DC[@]}" up -d db >/dev/null
for _ in $(seq 1 40); do
  cid="$("${DC[@]}" ps -q db 2>/dev/null || true)"
  st="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo missing)"
  [ "$st" = healthy ] && break
  # Containers without a healthcheck still report "starting" briefly — accept running.
  running="$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo false)"
  if [ "$st" != missing ] && [ "$running" = true ] && [ "$st" != starting ]; then break; fi
  if [ "$st" = missing ] && [ "$running" = true ]; then break; fi
  sleep 2
done

if [ "${SKIP_DB_BACKUP:-}" != 1 ]; then
  mkdir -p "$HOME/backups"
  backup="$HOME/backups/skillmark-$(date +%F-%H%M%S).sql"
  "${DC[@]}" exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" > "$backup"
  echo "Backup: $backup"
else
  echo "SKIP_DB_BACKUP=1 — skipping pg_dump"
fi

for f in $(ls "$INIT_DIR"/*.sql | sort); do
  case "$(basename "$f")" in 00-*|01-*) continue ;; esac
  echo "Applying $(basename "$f")"
  psql_db < "$f"
done

psql_db -c "NOTIFY pgrst, 'reload schema';"
echo "Done. PostgREST schema cache reload requested."
