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

/** Estrutura do arquivo; o conteúdo de cada item é validado pela migração, como nos dados salvos. */
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
  // A migração converte arquivos de versões anteriores e valida cada item.
  const incoming = migrate({ ...parsed, audit: [], runs: [] });
  const empty = () => ({ added: 0, replaced: 0, skipped: 0 });
  const report: ImportReport = {
    mode,
    counts: { llms: empty(), agents: empty(), prompts: empty(), mcpServers: empty(), memories: empty() },
    conflicts: [],
    warnings: [],
  };

  const keys = new Map(db.llms.map((l) => [l.id, l.apiKey]));
  /** Junta uma coleção do arquivo à atual e devolve o resultado; conta e registra conflitos no relatório. */
  const combine = <T extends { id: string; name?: string; content?: string }>(collection: Collection, current: T[], next: T[]): T[] => {
    const counts = report.counts[collection];
    if (mode === "replace") {
      for (const item of next) counts[current.some((x) => x.id === item.id) ? "replaced" : "added"]++;
      return next;
    }
    const added = next.filter((item) => {
      if (!current.some((x) => x.id === item.id)) return true;
      counts.skipped++;
      report.conflicts.push({ collection, id: item.id, name: label(item) });
      return false;
    });
    counts.added += added.length;
    return [...current, ...added];
  };
  const before = new Set(db.llms.map((l) => l.id));
  db.llms = combine("llms", db.llms, incoming.llms);
  db.agents = combine("agents", db.agents, incoming.agents);
  db.prompts = combine("prompts", db.prompts, incoming.prompts);
  db.mcpServers = combine("mcpServers", db.mcpServers, incoming.mcpServers);
  db.memories = combine("memories", db.memories, incoming.memories);
  // LLMs adicionadas ou substituídas a partir do arquivo (as mantidas como conflito não entram).
  const written = new Set(incoming.llms.filter((l) => mode === "replace" || !before.has(l.id)).map((l) => l.id));

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

  const total = Object.values(report.counts).reduce((n, c) => n + c.added + c.replaced, 0);
  audit({
    type: "config.changed",
    actor: "user",
    summary: `Configuração importada (${mode === "merge" ? "mesclar" : "substituir"}): ${total} itens, ${report.conflicts.length} conflitos`,
    data: report,
  });
  return report;
}
