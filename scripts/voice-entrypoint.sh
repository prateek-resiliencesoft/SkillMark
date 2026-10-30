#!/bin/sh
# Pick a voice relay from credentials / VOICE_RELAY_PROVIDER. Idle if none.
set -e

export VOICE_RELAY_HOST="${VOICE_RELAY_HOST:-0.0.0.0}"
export VOICE_RELAY_PORT="${VOICE_RELAY_PORT:-8082}"
export OPENAI_VOICE_RELAY_PORT="${OPENAI_VOICE_RELAY_PORT:-8082}"
export GEMINI_VOICE_RELAY_PORT="${GEMINI_VOICE_RELAY_PORT:-8082}"

PROVIDER="${VOICE_RELAY_PROVIDER:-auto}"

if [ "$PROVIDER" = "auto" ]; then
  if [ -n "${DOUBAO_APP_ID:-}" ] && [ -n "${DOUBAO_ACCESS_TOKEN:-}" ]; then
    PROVIDER=doubao
  elif [ -n "${AZURE_OPENAI_ENDPOINT:-}" ] && [ -n "${AZURE_OPENAI_API_KEY:-}" ]; then
    PROVIDER=openai
  elif [ -n "${GEMINI_API_KEY:-}${GOOGLE_API_KEY:-}" ]; then
    PROVIDER=gemini
  else
    echo "voice: no relay credentials set; sleeping (compose stays healthy)"
    exec sleep infinity
  fi
fi

echo "voice: starting provider=${PROVIDER} on :${VOICE_RELAY_PORT}"

case "$PROVIDER" in
  doubao) exec npx tsx server/voice-relay.ts ;;
  openai) exec npx tsx server/openai-voice-relay.ts ;;
  gemini) exec npx tsx server/gemini-voice-relay.ts ;;
  *)
    echo "voice: unknown VOICE_RELAY_PROVIDER=${PROVIDER}"
    exit 1
    ;;
esac
