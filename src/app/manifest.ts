import type { MetadataRoute } from "next";

// Lets the platform be installed as an app (phone home screen / desktop).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PANDO — Private Equity Intelligence",
    short_name: "PANDO",
    description: "Deal sourcing, pipeline and portfolio intelligence",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0F2D2B",
    theme_color: "#0F2D2B",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
