/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@ricky0123/vad-web", "onnxruntime-web"],
  experimental: {
    // Starts the background report sweeper (src/instrumentation.ts).
    instrumentationHook: true,
    serverComponentsExternalPackages: [
      "pdf-parse",
      "mammoth",
      "ws",
      "bufferutil",
      "utf-8-validate",
      "@langchain/core",
      "@langchain/langgraph",
      "@langfuse/core",
      "@langfuse/otel",
      "@langfuse/tracing",
      "@opentelemetry/sdk-trace-node",
    ],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
