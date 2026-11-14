/**
 * Onde a "API" roda:
 *  - server: o servidor Node local (npm run dev) — recursos completos, inclusive MCP via stdio;
 *  - browser: o núcleo roda dentro desta aba (GitHub Pages). Dados e chaves ficam no localStorage.
 *
 * VITE_RUNTIME=browser força o modo navegador (build do Pages). Sem isso, tentamos o servidor
 * e caímos para o navegador se ele não responder.
 */
type Core = typeof import("../../../core/index.ts");

export type RuntimeMode = "server" | "browser";

const forced = import.meta.env.VITE_RUNTIME as RuntimeMode | "auto" | undefined;
const STORAGE_KEY = "agentlab.db.v2";

let modePromise: Promise<RuntimeMode> | null = null;
let corePromise: Promise<Core> | null = null;

export function getMode(): Promise<RuntimeMode> {
  if (!modePromise) {
    modePromise = (async () => {
      if (forced === "browser" || forced === "server") return forced;
      try {
        const res = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/health`, { signal: AbortSignal.timeout(1500) });
        if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) return "server";
      } catch {
        /* servidor indisponível */
      }
      return "browser";
    })();
  }
  return modePromise;
}

export function getCore(): Promise<Core> {
  if (!corePromise) {
    corePromise = import("../../../core/index.ts").then((core) => {
      core.initCore({
        runtime: "browser",
        storage: {
          load() {
            try {
              const raw = localStorage.getItem(STORAGE_KEY);
              return raw ? JSON.parse(raw) : null;
            } catch {
              return null;
            }
          },
          save(db) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
          },
        },
        // O localStorage tem ~5 MB: guardamos menos histórico que no servidor.
        limits: { maxRuns: 25, maxAudit: 1500 },
      });
      return core;
    });
  }
  return corePromise;
}

/** Apaga todos os dados locais do modo navegador. */
export function resetBrowserData() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignora */
  }
  location.reload();
}
