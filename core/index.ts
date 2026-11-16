import { hostEnv } from "./env.js";
import { connect } from "./mcp/manager.js";
import { migrate, seedDb } from "./seed.js";
import { attachStorage, db, persist, type StorageAdapter } from "./store.js";
import { now } from "./util.js";

export { handle, subscribe, type ApiRequest, type ApiResponse } from "./router.js";
export type { StorageAdapter } from "./store.js";

export interface CoreOptions {
  storage: StorageAdapter;
  /** Multiplicador dos atrasos simulados da LLM demo (padrão 1; 0 nos testes). */
  demoDelayScale?: number;
  limits?: { maxAudit?: number; maxRuns?: number };
}

let started = false;

/** Carrega (ou cria) os dados, migra versões antigas e reconecta os servidores MCP habilitados. */
export function initCore(opts: CoreOptions) {
  if (started) return;
  started = true;
  hostEnv.demoDelayScale = opts.demoDelayScale ?? 1;
  attachStorage(opts.storage, opts.limits);
  const raw = opts.storage.load();
  Object.assign(db, raw ? migrate(raw as Record<string, unknown>) : seedDb());

  // Execuções interrompidas por um reinício não continuam sozinhas.
  for (const r of db.runs) {
    if (r.status === "running" || r.status === "awaiting_approval") {
      r.status = "failed";
      r.error = "A página foi recarregada durante a execução.";
      r.finishedAt = now();
    }
  }
  persist();
  // Reconecta os servidores habilitados. Os embutidos reconectam a cada carregamento da página,
  // então não geram registro de auditoria (falhas continuam sendo registradas).
  for (const s of db.mcpServers.filter((s) => s.enabled)) void connect(s, { silent: s.transport === "builtin" });
}
