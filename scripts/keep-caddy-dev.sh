#!/bin/bash
# Production deploy checks out main and replaces Caddyfile. Put the dev site back
# if that deploy did not include it yet.
set -euo pipefail
target=/opt/skillmark/Caddyfile
marker="dev.resiliencesoftinterview.com"
snippet=/opt/skillmark-dev/dev.caddy
if [ ! -f "$target" ] || [ ! -f "$snippet" ]; then
  exit 0
fi
if grep -q "$marker" "$target"; then
  exit 0
fi
printf '\n' >> "$target"
cat "$snippet" >> "$target"
docker exec skillmark-caddy-1 caddy reload --config /etc/caddy/Caddyfile >/dev/null
