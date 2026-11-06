/** Ambient shim so @ricky0123/vad-web type imports resolve under classic moduleResolution. */
declare module "onnxruntime-web/wasm" {
  export * from "onnxruntime-web";
}
