/// <reference types="vitest" />
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const apiTarget = process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { port: 5173, proxy: { "/api": { target: apiTarget, changeOrigin: true } } },
  preview: { port: 4173, proxy: { "/api": { target: apiTarget, changeOrigin: true } } },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icons/favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "InvoiceFlow — Invoices & Payments",
        short_name: "InvoiceFlow",
        description: "Create invoices, record M-Pesa and bank payments, and share PDFs — online or offline.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#ffffff",
        theme_color: "#0f625b",
        lang: "en-KE",
        categories: ["business", "finance", "productivity"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "New invoice", url: "/invoices/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
          { name: "Invoices", url: "/invoices", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
        ],
      },
      workbox: {
        // App shell is precached; API data is never cached by the service worker
        // (offline data lives in IndexedDB, managed by the app's sync engine).
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: "es2021",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: { manualChunks: { charts: ["recharts"], react: ["react", "react-dom", "react-router-dom"] } },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
