import fs from "node:fs";
import path from "node:path";
import type { AgentConfig, AuditEntry, McpServerConfig, Memory, PromptTemplate, RunRecord } from "./types.js";
import { seedAgents, seedMemories, seedPrompts, seedMcpServers } from "./seed.js";

/**
 * Persistência simples em arquivo JSON. Ideal para estudo: você pode abrir
 * `server/data/db.json` e ver exatamente o que a plataforma guarda.
 */
interface DB {
  agents: AgentConfig[];
  memories: Memory[];
  mcpServers: McpServerConfig[];
  prompts: PromptTemplate[];
  audit: AuditEntry[];
  runs: RunRecord[];
  settings: { anthropicApiKey?: string };
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const MAX_AUDIT = 5000;
const MAX_RUNS = 200;

function load(): DB {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<DB>;
    return {
      agents: parsed.agents ?? [],
      memories: parsed.memories ?? [],
      mcpServers: parsed.mcpServers ?? [],
      prompts: parsed.prompts ?? [],
      audit: parsed.audit ?? [],
      runs: parsed.runs ?? [],
      settings: parsed.settings ?? {},
    };
  } catch {
    return {
      agents: seedAgents(),
      memories: seedMemories(),
      mcpServers: seedMcpServers(),
      prompts: seedPrompts(),
      audit: [],
      runs: [],
      settings: {},
    };
  }
}

export const db: DB = load();

let timer: NodeJS.Timeout | null = null;
export function persist() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (db.audit.length > MAX_AUDIT) db.audit.splice(0, db.audit.length - MAX_AUDIT);
    if (db.runs.length > MAX_RUNS) db.runs.splice(0, db.runs.length - MAX_RUNS);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 300);
}

persist();
