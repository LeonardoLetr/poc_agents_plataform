import { z } from "zod";
import { audit } from "./audit.js";
import { connect, disconnect } from "./mcp/manager.js";
import { migrate, SEED_LLM } from "./seed.js";
import { db, persist } from "./store.js";
import type { AgentConfig, LlmConfig, McpServerConfig, Memory, PromptTemplate } from "./types.js";
import { now } from "./util.js";

/**
 * Exportação e importação da configuração em JSON versionado.
 *
 * Chaves de API e valores de cabeçalhos dos servidores MCP nunca saem: as LLMs vão sem `apiKey` e os cabeçalhos vão
 * só com o nome. Execuções e auditoria também ficam de fora (são registros, não configuração).
 */

export const EXPORT_FORMAT = "agent-lab-export";

export type ExportFile = {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  llms: Omit<LlmConfig, "apiKey">[];
  agents: AgentConfig[];
  prompts: PromptTemplate[];
  mcpServers: McpServerConfig[];
  memories: Memory[];
};

export function exportConfig(): ExportFile {
  return {
    format: EXPORT_FORMAT,
    version: db.version,
    exportedAt: now(),
    llms: db.llms.map(({ apiKey: _key, ...rest }) => structuredClone(rest)),
    agents: structuredClone(db.agents),
    prompts: structuredClone(db.prompts),
    mcpServers: db.mcpServers.map((s) => ({
      ...structuredClone(s),
      headers: Object.fromEntries(Object.keys(s.headers ?? {}).map((k) => [k, ""])),
    })),
    memories: structuredClone(db.memories),
  };
}

/** Validação da estrutura do arquivo: o conteúdo de cada item é normalizado pela migração de dados. */
const withId = z.object({ id: z.string().min(1) }).loose();
const ImportSchema = z.object({
  format: z.literal(EXPORT_FORMAT, { message: "Arquivo não é uma exportação do Agent Lab." }),
  version: z.number().int().min(1),
  llms: z.array(withId).default([]),
  agents: z.array(withId.extend({ name: z.string(), llmId: z.string(), tools: z.array(z.string()) })).default([]),
  prompts: z.array(withId).default([]),
  mcpServers: z.array(withId.extend({ name: z.string() })).default([]),
  memories: z.array(withId).default([]),
});

type Collection = "llms" | "agents" | "prompts" | "mcpServers" | "memories";
const COLLECTIONS: Collection[] = ["llms", "agents", "prompts", "mcpServers", "memories"];

export type ImportReport = {
  mode: "merge" | "replace";
  /** Por coleção: itens adicionados, substituídos e ignorados (conflitos no modo mesclar). */
  counts: Record<Collection, { added: number; replaced: number; skipped: number }>;
  /** Itens que já existiam (mesmo id) e foram mantidos no modo mesclar. */
  conflicts: { collection: Collection; id: string; name: string }[];
  warnings: string[];
};

const label = (item: { id: string; name?: string; content?: string }) => item.name ?? (item.content ? item.content.slice(0, 60) : item.id);

/**
 * Importa uma exportação.
 * - `merge`: adiciona itens novos e mantém os existentes (mesmo id), listando-os como conflitos.
 * - `replace`: substitui toda a configuração; chaves de LLMs com o mesmo id são preservadas.
 */
export async function importConfig(raw: unknown, mode: "merge" | "replace"): Promise<ImportReport> {
  const parsed = ImportSchema.parse(raw);
  if (parsed.version > db.version)
    throw new Error(`O arquivo é de uma versão mais nova da plataforma (${parsed.version}); atualize a página e tente de novo.`);
  // A migração normaliza arquivos de versões anteriores para o formato atual.
  const incoming = migrate({ ...parsed, audit: [], runs: [] });
  const report: ImportReport = {
    mode,
    counts: Object.fromEntries(COLLECTIONS.map((c) => [c, { added: 0, replaced: 0, skipped: 0 }])) as ImportReport["counts"],
    conflicts: [],
    warnings: [],
  };

  const keys = new Map(db.llms.map((l) => [l.id, l.apiKey]));
  const written = new Set<string>(); // ids de LLMs adicionadas ou substituídas a partir do arquivo
  for (const c of COLLECTIONS) {
    const current = db[c] as { id: string; name?: string }[];
    const next = incoming[c] as { id: string; name?: string }[];
    if (mode === "replace") {
      for (const item of next) {
        report.counts[c][current.some((x) => x.id === item.id) ? "replaced" : "added"]++;
        if (c === "llms") written.add(item.id);
      }
      (db[c] as unknown[]) = next;
    } else {
      for (const item of next) {
        if (current.some((x) => x.id === item.id)) {
          report.counts[c].skipped++;
          report.conflicts.push({ collection: c, id: item.id, name: label(item) });
        } else {
          current.push(item);
          report.counts[c].added++;
          if (c === "llms") written.add(item.id);
        }
      }
    }
  }

  // Chaves nunca vêm no arquivo: mantém as que já existiam para as mesmas LLMs.
  for (const l of db.llms) if (!l.apiKey && keys.get(l.id)) l.apiKey = keys.get(l.id);
  const withoutKey = db.llms.filter((l) => l.provider !== "demo" && !l.apiKey && written.has(l.id));
  if (withoutKey.length) report.warnings.push(`Informe a chave em “LLMs” para: ${withoutKey.map((l) => l.name).join(", ")}.`);

  // Agentes que apontam para LLMs inexistentes passam a usar a LLM demo.
  for (const a of db.agents) {
    if (db.llms.some((l) => l.id === a.llmId)) continue;
    const fallback = db.llms.find((l) => l.id === SEED_LLM.demo) ?? db.llms[0];
    if (!fallback) continue;
    report.warnings.push(`O agente "${a.name}" usava uma LLM ausente e passou a usar "${fallback.name}".`);
    a.llmId = fallback.id;
  }

  const blankHeaders = db.mcpServers.filter((s) => Object.values(s.headers ?? {}).some((v) => !v));
  if (blankHeaders.length)
    report.warnings.push(`Preencha os cabeçalhos (ex.: Authorization) dos servidores MCP: ${blankHeaders.map((s) => s.name).join(", ")}.`);

  persist();
  // Servidores MCP: reconecta a lista atual (os removidos são desconectados).
  for (const s of incoming.mcpServers) await disconnect(s.id, false);
  for (const s of db.mcpServers.filter((x) => x.enabled)) void connect(s, { silent: true });

  const total = COLLECTIONS.reduce((n, c) => n + report.counts[c].added + report.counts[c].replaced, 0);
  audit({
    type: "config.changed",
    actor: "user",
    summary: `Configuração importada (${mode === "merge" ? "mesclar" : "substituir"}): ${total} itens, ${report.conflicts.length} conflitos`,
    data: report,
  });
  return report;
}
