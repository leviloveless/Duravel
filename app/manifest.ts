import type { MetadataRoute } from "next";

/**
 * PWA web app manifest (App Store plan §2.2). Next.js serves this at
 * /manifest.webmanifest and auto-injects the <link rel="manifest"> tag. Gives the
 * app an installable home-screen identity and is a prerequisite for the Capacitor
 * wrapper (Phase 2). Icons live in /public.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Duravel",
    short_name: "Duravel",
    description: "AI-powered HYROX training programs that adapt to every session you log.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
