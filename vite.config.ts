import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            // Cache API responses for offline read
            urlPattern: /^http:\/\/localhost:3001\/api\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "mdc-api",
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
      manifest: {
        name: "MDC Inventory",
        short_name: "MDC",
        description: "DC Inventory Management System",
        theme_color: "#0b4fa8",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-api": [],
          "vendor-ui": ["lucide-react"],
          "vendor-query": ["@tanstack/react-query", "@tanstack/react-table"],
          "vendor-zxing": ["@zxing/browser", "@zxing/library"],
        },
      },
    },
  },
});
