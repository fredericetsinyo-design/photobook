import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// PWA : l'application et ses polices sont mises en cache à la première visite,
// puis tout fonctionne sans connexion (import, composition, export, sauvegarde).
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      includeAssets: ["favicon.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "PhotoBook — Fredy Photography",
        short_name: "PhotoBook",
        description: "Planches photo et collages automatiques pour photographes, prêts à imprimer.",
        lang: "fr",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "any",
        theme_color: "#39404B",
        background_color: "#232831",
        categories: ["photo", "productivity"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff,woff2,png,svg,webmanifest}"],
        globIgnores: ["icons/icon-1024.png"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 },
});
