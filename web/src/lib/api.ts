// Tipos do núcleo usados pela interface + cliente que fala com o núcleo no navegador.
import type { publicLlm } from "../../../core/llm/index";
import type { publicState } from "../../../core/mcp/manager";
import type { Citation } from "../../../core/tools/server";
import type { AgentConfig, LlmConfig, McpServerConfig, RunEvent as CoreRunEvent, RunRecord, RunStatus } from "../../../core/types";
import { z } from "zod";
import { getCore } from "./runtime";

export type { AuditEntry, Effort, Memory, MemoryKind, PromptTemplate, Provider, RunStatus } from "../../../core/types";
export type { Citation };

export type Agent = AgentConfig;
export type AgentInput = Omit<Agent, "id" | "createdAt" | "updatedAt">;

/** LLM como a rota devolve: sem a chave, com o indicador de prontidão e os agentes que a usam. */
export type Llm = ReturnType<typeof publicLlm> & { agents: string[] };
export type LlmInput = Pick<LlmConfig, "name" | "provider" | "model" | "baseUrl" | "effort" | "refusalFallback" | "contextWindow"> & {
  apiKey?: string;
  maxTokens?: number;
};

export type ToolInfo = {
  name: string;
  description: string;
  inputSchema: { properties?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[] };
  source: "builtin" | "mcp" | "server" | "agent";
  server?: string;
  category: string;
  /** Multiagente: agente representado pela ferramenta e seu rótulo (emoji + nome). */
  agentId?: string;
  label?: string;
  /** MCP conectado pela API da Anthropic: ferramentas conhecidas só durante a execução. */
  viaAnthropic?: boolean;
};

type McpState = ReturnType<typeof publicState>;

/**
 * Servidor MCP como a rota devolve: cabeçalhos com valores ocultos (••••) e o estado da conexão.
 * O núcleo guarda o esquema das ferramentas como JSON Schema genérico; a interface lê só os campos do formulário.
 */
export type McpServer = McpServerConfig & {
  state: Omit<McpState, "tools"> & { tools: (Omit<McpState["tools"][number], "inputSchema"> & { inputSchema: ToolInfo["inputSchema"] })[] };
};

export type RunEvent = CoreRunEvent & { ts: string };
export type RunDetail = Omit<RunRecord, "events"> & { events: RunEvent[] };
export type RunSummary = Omit<RunDetail, "events" | "messages"> & { eventCount?: number };

export type Health = {
  ok: boolean;
  capabilities: { builtinMcp: string[] };
  llmsReady: number;
  llmsTotal: number;
  catalog: {
    anthropic: { id: string; label: string; note: string; fallback: boolean }[];
    openai: { id: string; label: string; baseUrl: string; model: string; needsKey: boolean }[];
  };
};

export type Stats = {
  agents: number;
  llms: number;
  runs: number;
  runsByStatus: Record<string, number>;
  memories: number;
  mcpServers: number;
  mcpConnected: number;
  toolCalls: number;
  toolUsage: Record<string, number>;
  tokens: { input: number; output: number };
  estimatedCostUsd: number;
  auditEntries: number;
};

/** A "requisição" é uma chamada de função ao núcleo, na mesma aba. */
/** Corpo de erro das rotas: mensagem simples ou a lista de problemas de validação. */
const ErrorBody = z.object({
  error: z.string().optional(),
  issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })).optional(),
});

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const core = await getCore();
  const parsed = new URL(url, "http://local");
  const res = await core.handle({ method, path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), body: body ?? {} });
  const status = res.status;
  const data: unknown = JSON.parse(JSON.stringify(res.body ?? null)); // cópia: a UI não pode mutar o estado do núcleo
  if (status >= 400) {
    const parsedError = ErrorBody.safeParse(data);
    const { error, issues } = parsedError.success ? parsedError.data : {};
    const detail = issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(detail || error || `HTTP ${status}`);
  }
  // O núcleo roda no mesmo processo e é a fonte da resposta; quem chama informa o tipo da rota.
  return data as T;
}

/** Assina um stream ao vivo do núcleo (execuções, auditoria, status do MCP). Devolve o cancelamento. */
export function subscribeStream(url: string, onMessage: (data: unknown) => void, onStatus: (connected: boolean) => void): () => void {
  let cancel = () => {};
  let closed = false;
  void getCore().then((core) => {
    if (closed) return;
    // Entrega assíncrona e com cópia, para a UI nunca compartilhar objetos com o núcleo.
    const stop = core.subscribe(url, (data) => {
      const copy: unknown = JSON.parse(JSON.stringify(data));
      queueMicrotask(() => onMessage(copy));
    });
    onStatus(Boolean(stop));
    cancel = () => stop?.();
  });
  return () => {
    closed = true;
    cancel();
    onStatus(false);
  };
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>("PUT", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};

export type CompareResult = {
  runId: string;
  agentId: string;
  agentName: string;
  llmId?: string;
  llmName: string;
  provider: string;
  model: string;
  status: RunStatus;
  error: string | null;
  output: string | null;
  iterations: number;
  tokens: { input: number; output: number; total: number };
  costUsd: number | null;
  durationMs: number | null;
  toolCalls: number;
  tools: string[];
};
export type Comparison = {
  id: string;
  input: string;
  startedAt: string;
  done: boolean;
  results: CompareResult[];
};
export type ComparisonSummary = {
  id: string;
  input: string;
  startedAt: string;
  count: number;
  done: boolean;
};
