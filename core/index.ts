import { hostEnv } from "./env.js";
import { connect } from "./mcp/manager.js";
import { migrate, seedDb } from "./seed.js";
import { attachStorage, db, persist, type StorageAdapter } from "./store.js";
import { now } from "./util.js";

export { handle, subscribe, type ApiRequest, type ApiResponse } from "./router.js";
export { registerStdioTransport } from "./mcp/manager.js";
export type { StorageAdapter } from "./store.js";

export interface CoreOptions {
  runtime: "server" | "browser";
  storage: StorageAdapter;
  env?: { ANTHROPIC_API_KEY?: string; ANTHROPIC_AUTH_TOKEN?: string; OPENAI_API_KEY?: string };
  limits?: { maxAudit?: number; maxRuns?: number };
}

let started = false;

/** Carrega (ou cria) os dados, migra versões antigas e reconecta os servidores MCP habilitados. */
export function initCore(opts: CoreOptions) {
  if (started) return;
  started = true;
  Object.assign(hostEnv, { runtime: opts.runtime, ...opts.env });
  attachStorage(opts.storage, opts.limits);
  const raw = opts.storage.load();
  Object.assign(db, raw ? migrate(raw as Record<string, unknown>, opts.runtime) : seedDb(opts.runtime));

  // Execuções interrompidas por um reinício não continuam sozinhas.
  for (const r of db.runs) {
    if (r.status === "running" || r.status === "awaiting_approval") {
      r.status = "failed";
      r.error = opts.runtime === "browser" ? "A página foi recarregada durante a execução." : "Servidor reiniciado durante a execução.";
      r.finishedAt = now();
    }
  }
  persist();
  for (const s of db.mcpServers.filter((s) => s.enabled)) void connect(s);
}
