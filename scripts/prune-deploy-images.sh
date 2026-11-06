#!/usr/bin/env bash
# Drop SkillMark app/voice images left by earlier deploys.
# The tag running in skillmark-app-1 / skillmark-voice-1 is kept.
# Does not prune volumes, so Postgres data, uploads, and Caddy certs stay.
set -euo pipefail

if [ -z "${IMAGE_TAG:-}" ]; then
  IMAGE_TAG="$(docker inspect -f '{{.Config.Image}}' skillmark-app-1 2>/dev/null | awk -F: '{print $NF}')"
fi
if [ -z "${IMAGE_TAG:-}" ]; then
  echo "IMAGE_TAG unset and skillmark-app-1 is not running. Refusing to prune." >&2
  exit 1
fi

echo "Keeping SkillMark image tag ${IMAGE_TAG}"

# Untagged leftovers only. Without -a this does not remove tagged images or volumes.
docker image prune -f

for repo in \
  ghcr.io/prateek-resiliencesoft/skillmark-app \
  ghcr.io/prateek-resiliencesoft/skillmark-voice
do
  docker images "$repo" --format '{{.Tag}}' | while read -r tag; do
    [ -n "$tag" ] || continue
    [ "$tag" = "$IMAGE_TAG" ] && continue
    [ "$tag" = "<none>" ] && continue
    echo "Removing ${repo}:${tag}"
    docker rmi "${repo}:${tag}" || true
  done
done

docker image prune -f
echo "Image prune done. Volumes were not touched."
