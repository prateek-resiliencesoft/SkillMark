#!/usr/bin/env bash
# Copy MediaPipe wasm + download the face model into public/ so head tracking works without a CDN.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/mediapipe/wasm
cp node_modules/@mediapipe/tasks-vision/wasm/* public/mediapipe/wasm/
[ -s public/mediapipe/face_landmarker.task ] || curl -fsSL -o public/mediapipe/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
echo "MediaPipe assets ready in public/mediapipe"
