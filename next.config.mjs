/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: [
      "pdf-parse",
      "mammoth",
      "ws",
      "bufferutil",
      "utf-8-validate",
      "aws4fetch",
    ],
    // Ensure B2/S3 client lands in the Docker standalone image
    outputFileTracingIncludes: {
      "/api/**/*": ["./node_modules/aws4fetch/**/*"],
      "/*": ["./node_modules/aws4fetch/**/*"],
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
