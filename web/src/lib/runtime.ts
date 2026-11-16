/**
 * O núcleo da plataforma (core/) roda dentro desta aba: a "API" é uma chamada de função, sem servidor.
 * Dados ficam no localStorage; chaves de API ficam num cofre separado (sessionStorage por padrão).
 */
type Core = typeof import("../../../core/index.ts");

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

let corePromise: Promise<Core> | null = null;

export function getCore(): Promise<Core> {
  if (!corePromise) {
    corePromise = import("../../../core/index.ts").then((core) => {
      core.initCore({
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
              for (const l of data.llms ?? []) {
                const key = keys[l.id];
                if (key) l.apiKey = key;
                else delete l.apiKey;
              }
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
        // O localStorage tem ~5 MB: o histórico guardado é limitado.
        limits: { maxRuns: 25, maxAudit: 1500 },
      });
      return core;
    });
  }
  return corePromise;
}

/** Apaga todos os dados salvos neste navegador. */
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
