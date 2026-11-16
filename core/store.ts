import type { AgentConfig, AuditEntry, LlmConfig, McpServerConfig, Memory, PromptTemplate, RunRecord } from "./types.js";

/**
 * Estado da plataforma. O núcleo não sabe ONDE ele é salvo: o hospedeiro
 * (servidor Node → arquivo JSON; navegador → localStorage) fornece um adaptador.
 */
export interface DB {
  version: number;
  llms: LlmConfig[];
  agents: AgentConfig[];
  memories: Memory[];
  mcpServers: McpServerConfig[];
  prompts: PromptTemplate[];
  audit: AuditEntry[];
  runs: RunRecord[];
}

export interface StorageAdapter {
  load(): unknown | null;
  save(db: DB): void;
}

export const db: DB = { version: 4, llms: [], agents: [], memories: [], mcpServers: [], prompts: [], audit: [], runs: [] };

let adapter: StorageAdapter | null = null;
let limits = { maxAudit: 5000, maxRuns: 200 };
let timer: ReturnType<typeof setTimeout> | null = null;

export function attachStorage(a: StorageAdapter, opts: Partial<typeof limits> = {}) {
  adapter = a;
  limits = { ...limits, ...opts };
}

export function persist() {
  if (timer || !adapter) return;
  timer = setTimeout(() => {
    timer = null;
    if (db.audit.length > limits.maxAudit) db.audit.splice(0, db.audit.length - limits.maxAudit);
    if (db.runs.length > limits.maxRuns) db.runs.splice(0, db.runs.length - limits.maxRuns);
    try {
      adapter!.save(db);
    } catch (err) {
      // Ex.: cota do localStorage estourada — descarta execuções antigas e tenta de novo.
      console.warn("Falha ao salvar, compactando histórico…", err);
      db.runs.splice(0, Math.ceil(db.runs.length / 2));
      db.audit.splice(0, Math.ceil(db.audit.length / 2));
      try {
        adapter!.save(db);
      } catch {
        /* desiste silenciosamente */
      }
    }
  }, 300);
}
