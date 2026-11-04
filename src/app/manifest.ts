import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ResilienceSoft Interview",
    short_name: "ResilienceSoft",
    description: "Practice • Interview • Grow",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#5941F2",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
