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
/** Chaves de API ficam FORA do banco principal, num cofre separado. */
const KEYS_KEY = "agentlab.keys";
const REMEMBER_KEY = "agentlab.keys.remember";

type KeyMap = Record<string, string>;

function safeGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(store: Storage, key: string, value: string | null) {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    /* armazenamento indisponível */
  }
}
const readKeys = (store: Storage): KeyMap => {
  try {
    return JSON.parse(safeGet(store, KEYS_KEY) ?? "{}") as KeyMap;
  } catch {
    return {};
  }
};

/**
 * Por padrão as chaves vivem só no sessionStorage: somem ao fechar o navegador.
 * Com "lembrar" ligado, vão para o localStorage e sobrevivem entre visitas.
 */
export function getRememberKeys(): boolean {
  return safeGet(localStorage, REMEMBER_KEY) === "1";
}
export function setRememberKeys(remember: boolean) {
  const keys = { ...readKeys(localStorage), ...readKeys(sessionStorage) };
  safeSet(localStorage, REMEMBER_KEY, remember ? "1" : null);
  const json = Object.keys(keys).length ? JSON.stringify(keys) : null;
  safeSet(remember ? localStorage : sessionStorage, KEYS_KEY, json);
  safeSet(remember ? sessionStorage : localStorage, KEYS_KEY, null);
}

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
              if (!raw) return null;
              const data = JSON.parse(raw) as { llms?: { id: string; apiKey?: string }[] };
              // Versões antigas guardavam a chave junto: move para o cofre e limpa.
              const legacy: KeyMap = {};
              for (const l of data.llms ?? []) if (l.apiKey) legacy[l.id] = l.apiKey;
              const keys = { ...legacy, ...readKeys(localStorage), ...readKeys(sessionStorage) };
              for (const l of data.llms ?? []) l.apiKey = keys[l.id] || undefined;
              return data;
            } catch {
              return null;
            }
          },
          save(db) {
            const keys: KeyMap = {};
            const llms = db.llms.map(({ apiKey, ...rest }) => {
              if (apiKey) keys[rest.id] = apiKey;
              return rest;
            });
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...db, llms }));
            const remember = getRememberKeys();
            const json = Object.keys(keys).length ? JSON.stringify(keys) : null;
            safeSet(remember ? localStorage : sessionStorage, KEYS_KEY, json);
            safeSet(remember ? sessionStorage : localStorage, KEYS_KEY, null);
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
    localStorage.removeItem(KEYS_KEY);
    localStorage.removeItem(REMEMBER_KEY);
    sessionStorage.removeItem(KEYS_KEY);
  } catch {
    /* ignora */
  }
  location.reload();
}
