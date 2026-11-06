#!/usr/bin/env bash
# Copy Silero VAD onnx + worklet and onnxruntime-web wasm into public/ so
# client VAD works without a CDN (needed on live behind Caddy).
set -euo pipefail
cd "$(dirname "$0")/.."

VAD_PKG=node_modules/@ricky0123/vad-web/dist
ORT_PKG=node_modules/onnxruntime-web/dist

if [ ! -d "$VAD_PKG" ] || [ ! -d "$ORT_PKG" ]; then
  echo "vad-assets: install @ricky0123/vad-web and onnxruntime-web first (npm ci)" >&2
  exit 1
fi

mkdir -p public/vad
rm -f public/vad/*

cp -f "$VAD_PKG"/vad.worklet.bundle.min.js public/vad/
cp -f "$VAD_PKG"/silero_vad_legacy.onnx public/vad/
cp -f "$VAD_PKG"/silero_vad_v5.onnx public/vad/
cp -f "$VAD_PKG"/silero_vad_v6.onnx public/vad/

# Default threaded wasm + JS bindings (skip asyncify/jsep/jspi variants — ~60MB saved)
cp -f "$ORT_PKG"/ort-wasm-simd-threaded.wasm public/vad/
cp -f "$ORT_PKG"/ort-wasm-simd-threaded.mjs public/vad/

echo "Silero VAD assets ready in public/vad ($(du -sh public/vad | cut -f1))"
