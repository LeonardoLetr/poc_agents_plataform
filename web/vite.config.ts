import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // No GitHub Pages a app fica em /<nome-do-repo>/ (definido pelo workflow).
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1200 },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
});
