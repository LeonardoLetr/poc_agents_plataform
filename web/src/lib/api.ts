// Tipos espelhados do núcleo + cliente que fala com o servidor OU com o núcleo no navegador.
import { getCore } from "./runtime";

export type Provider = "anthropic" | "openai" | "demo";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type Agent = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  description: string;
  llmId: string;
  systemPrompt: string;
  tools: string[];
  maxIterations: number;
  requireApproval: boolean;
  memory: { autoRecall: boolean; autoEpisode: boolean; recallLimit: number; recallEpisodes?: boolean };
  context?: { autoCompact: boolean; thresholdPct: number };
  createdAt: string;
  updatedAt: string;
};

export type Llm = {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  baseUrl?: string | undefined;
  effort: Effort;
  refusalFallback: boolean;
  maxTokens: number;
  contextWindow?: number | undefined;
  apiKeySet: boolean;
  apiKeyHint: string | null;
  ready: boolean;
  agents: string[];
  createdAt: string;
  updatedAt: string;
};
export type LlmInput = {
  name: string;
  provider: Provider;
  model: string;
  apiKey?: string;
  baseUrl?: string | undefined;
  effort: Effort;
  refusalFallback: boolean;
  maxTokens?: number;
  contextWindow?: number | undefined;
};

export type AgentInput = Omit<Agent, "id" | "createdAt" | "updatedAt">;

export type MemoryKind = "fact" | "episode" | "preference" | "procedure";
export type Memory = {
  id: string;
  agentId: string | null;
  kind: MemoryKind;
  content: string;
  tags: string[];
  importance: number;
  accessCount: number;
  createdAt: string;
  lastAccessedAt: string | null;
  source: "user" | "agent" | "auto";
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

export type McpServer = {
  id: string;
  name: string;
  transport: "http" | "builtin";
  command?: string;
  args?: string[];
  url?: string;
  /** Nomes dos cabeçalhos; os valores chegam ocultos (••••). */
  headers?: Record<string, string>;
  via?: "client" | "anthropic";
  knownTools?: { name: string; description?: string; source: "discovered" | "used" }[];
  enabled: boolean;
  createdAt: string;
  state: {
    status: "disconnected" | "connecting" | "connected" | "error";
    error?: string;
    tools: { name: string; qualifiedName: string; description: string; inputSchema: ToolInfo["inputSchema"] }[];
    serverInfo?: { name: string; version: string };
    instructions?: string;
    connectedAt?: string;
    logs: string[];
  };
};

export type PromptTemplate = {
  id: string;
  name: string;
  description: string;
  content: string;
  category: "system" | "task";
  createdAt: string;
};

export type AuditEntry = {
  id: string;
  ts: string;
  type: string;
  actor: "user" | "agent" | "system";
  agentId?: string;
  runId?: string;
  summary: string;
  data?: unknown;
  durationMs?: number;
  tokens?: { input: number; output: number; cacheRead?: number };
};

export type RunStatus = "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
export type RunSummary = {
  id: string;
  agentId: string;
  agentName: string;
  input: string;
  status: RunStatus;
  output: string | null;
  error: string | null;
  iterations: number;
  usage: { input: number; output: number };
  startedAt: string;
  finishedAt: string | null;
  eventCount?: number;
  parentRunId?: string;
  depth?: number;
  childRunIds?: string[];
  childUsage?: { input: number; output: number };
};
export type RunDetail = {
  events: RunEvent[];
  messages: unknown[];
  systemPrompt: string;
  scratchpad: string[];
} & RunSummary;

export type Citation = {
  url: string;
  title: string | null;
  citedText: string;
};

export type RunEvent = { ts: string } & (
  | { type: "run.started"; runId: string; agentId: string; input: string; provider: Provider; model: string; llmName?: string }
  | { type: "memory.recalled"; memories: { id: string; content: string; score: number; kind: MemoryKind }[] }
  | { type: "iteration.started"; iteration: number }
  | { type: "llm.request"; iteration: number; messageCount: number; toolCount: number; systemPrompt: string }
  | { type: "thinking.delta"; text: string }
  | { type: "text.delta"; text: string }
  | {
      type: "llm.response";
      iteration: number;
      stopReason: string | null;
      usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
      durationMs: number;
      model: string;
    }
  | { type: "tool.call"; id: string; name: string; input: unknown; source: "builtin" | "mcp" | "server" | "agent"; server?: string }
  | { type: "tool.approval_requested"; id: string; name: string; input: unknown }
  | { type: "tool.approval_resolved"; id: string; approved: boolean }
  | { type: "tool.result"; id: string; name: string; output: string; isError: boolean; durationMs: number }
  | { type: "citations"; items: Citation[] }
  | {
      type: "context.measured";
      iteration: number;
      tokens: number;
      window: number;
      cacheRead: number;
      breakdown: { system: number; tools: number; history: number };
      messageCount: number;
    }
  | {
      type: "context.compacted";
      iteration: number;
      tokensBefore: number;
      tokensAfter: number;
      messagesBefore: number;
      summary: string;
      thresholdPct: number;
    }
  | { type: "delegation.started"; toolUseId: string; childRunId: string; agentId: string; agentName: string; task: string }
  | {
      type: "delegation.finished";
      toolUseId: string;
      childRunId: string;
      status: RunStatus;
      iterations: number;
      usage: { input: number; output: number };
    }
  | { type: "memory.created"; memory: Memory }
  | { type: "user.message"; text: string }
  | {
      type: "run.completed";
      output: string;
      iterations: number;
      usage: { input: number; output: number };
      childUsage?: { input: number; output: number };
    }
  | { type: "run.failed"; error: string }
  | { type: "run.cancelled" }
);

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
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const core = await getCore();
  const parsed = new URL(url, "http://local");
  const res = await core.handle({ method, path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), body: body ?? {} });
  const status = res.status;
  const data: unknown = JSON.parse(JSON.stringify(res.body ?? null)); // cópia: a UI não pode mutar o estado do núcleo
  if (status >= 400) {
    const issues = (data as { issues?: { path: string[]; message: string }[] }).issues;
    const detail = issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(detail || (data as { error?: string }).error || `HTTP ${status}`);
  }
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
