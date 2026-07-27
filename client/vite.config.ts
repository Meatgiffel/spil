import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Spil — brætspilshistorik",
        short_name: "Spil",
        description: "Hold styr på hvilke brætspil I har spillet.",
        lang: "da",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f3f2f2",
        theme_color: "#ec3013",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        // /api caches bevidst ikke: data kommer fra IndexedDB, ikke fra service
        // worker'en. To lag der cacher det samme giver kun tvivl om hvad der er nyest.
        navigateFallbackDenylist: [/^\/api/, /^\/uploads/],
        runtimeCaching: [
          {
            // Spilcovers og partifotos skal virke offline.
            urlPattern: /^\/uploads\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "spil-uploads",
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 180 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:5060", changeOrigin: false },
      "/uploads": { target: "http://127.0.0.1:5060", changeOrigin: false },
    },
  },
  // Preview bruges af Playwright: service worker'en findes kun i en
  // produktionsbygning, og det er offline-adfærden der skal testes.
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: "http://127.0.0.1:5060", changeOrigin: false },
      "/uploads": { target: "http://127.0.0.1:5060", changeOrigin: false },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
