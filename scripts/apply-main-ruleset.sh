#!/usr/bin/env bash
# Apply .github/rulesets/protect-main.json via GitHub Rulesets API.
# Keep protect-main.yaml in sync when editing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JSON="$ROOT/.github/rulesets/protect-main.json"
OWNER_REPO="${OWNER_REPO:-prateek-resiliencesoft/SkillMark}"

if ! command -v gh >/dev/null; then
  echo "gh CLI required" >&2
  exit 1
fi

EXISTING_ID="$(gh api "repos/${OWNER_REPO}/rulesets" --jq '.[] | select(.name=="Protect main — only from dev") | .id' | head -1 || true)"

if [ -n "${EXISTING_ID}" ]; then
  echo "Updating ruleset ${EXISTING_ID}..."
  gh api --method PUT "repos/${OWNER_REPO}/rulesets/${EXISTING_ID}" --input "$JSON"
else
  echo "Creating ruleset..."
  gh api --method POST "repos/${OWNER_REPO}/rulesets" --input "$JSON"
fi

echo "Done. Verify: gh api repos/${OWNER_REPO}/rulesets"
