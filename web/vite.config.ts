import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Content-Security-Policy do build publicado: o navegador só executa scripts
 * vindos do próprio site. Mesmo que algum conteúdo malicioso aparecesse na
 * página, ele não conseguiria carregar código de fora para ler suas chaves.
 * - connect-src https: → as LLMs são chamadas direto do navegador (qualquer provedor HTTPS)
 * - localhost → provedores locais como o Ollama
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const contentSecurityPolicy = (): Plugin => ({
  name: "agent-lab-csp",
  apply: "build",
  transformIndexHtml: (html) => html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="no-referrer" />`),
});

export default defineConfig({
  // No GitHub Pages a app fica em /<nome-do-repo>/ (definido pelo workflow).
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  build: { chunkSizeWarningLimit: 1200 },
  server: { port: 5173 },
});
