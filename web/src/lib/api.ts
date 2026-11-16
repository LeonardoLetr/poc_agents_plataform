// Tipos espelhados do núcleo + cliente que fala com o servidor OU com o núcleo no navegador.
import { getCore, getMode } from "./runtime";

export type Provider = "anthropic" | "openai" | "demo";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Agent {
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
  createdAt: string;
  updatedAt: string;
}

export interface Llm {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  baseUrl?: string;
  effort: Effort;
  refusalFallback: boolean;
  maxTokens: number;
  apiKeySet: boolean;
  apiKeyHint: string | null;
  ready: boolean;
  agents: string[];
  createdAt: string;
  updatedAt: string;
}
export interface LlmInput {
  name: string;
  provider: Provider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  effort: Effort;
  refusalFallback: boolean;
  maxTokens?: number;
}

export type AgentInput = Omit<Agent, "id" | "createdAt" | "updatedAt">;

export type MemoryKind = "fact" | "episode" | "preference" | "procedure";
export interface Memory {
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
}

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: { properties?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[] };
  source: "builtin" | "mcp" | "server";
  server?: string;
  category: string;
}

export interface McpServer {
  id: string;
  name: string;
  transport: "stdio" | "http" | "builtin";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
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
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  category: "system" | "task";
  createdAt: string;
}

export interface AuditEntry {
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
}

export type RunStatus = "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
export interface RunSummary {
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
}
export interface RunDetail extends RunSummary {
  events: RunEvent[];
  messages: unknown[];
  systemPrompt: string;
  scratchpad: string[];
}

export interface Citation {
  url: string;
  title: string | null;
  citedText: string;
}

export type RunEvent = { ts: string } & (
  | { type: "run.started"; runId: string; agentId: string; input: string; provider: Provider; model: string; llmName?: string }
  | { type: "memory.recalled"; memories: { id: string; content: string; score: number; kind: MemoryKind }[] }
  | { type: "iteration.started"; iteration: number }
  | { type: "llm.request"; iteration: number; messageCount: number; toolCount: number; systemPrompt: string }
  | { type: "thinking.delta"; text: string }
  | { type: "text.delta"; text: string }
  | { type: "llm.response"; iteration: number; stopReason: string | null; usage: { input: number; output: number; cacheRead?: number }; durationMs: number; model: string }
  | { type: "tool.call"; id: string; name: string; input: unknown; source: "builtin" | "mcp" | "server"; server?: string }
  | { type: "tool.approval_requested"; id: string; name: string; input: unknown }
  | { type: "tool.approval_resolved"; id: string; approved: boolean }
  | { type: "tool.result"; id: string; name: string; output: string; isError: boolean; durationMs: number }
  | { type: "citations"; items: Citation[] }
  | { type: "memory.created"; memory: Memory }
  | { type: "user.message"; text: string }
  | { type: "run.completed"; output: string; iterations: number; usage: { input: number; output: number } }
  | { type: "run.failed"; error: string }
  | { type: "run.cancelled" }
);

export interface Health {
  ok: boolean;
  runtime: "server" | "browser";
  capabilities: { stdio: boolean; builtinMcp: string[] };
  llmsReady: number;
  llmsTotal: number;
  catalog: {
    anthropic: { id: string; label: string; note: string; fallback: boolean }[];
    openai: { id: string; label: string; baseUrl: string; model: string; needsKey: boolean }[];
  };
}

export interface Stats {
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
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let status: number;
  let data: unknown;
  if ((await getMode()) === "browser") {
    // Modo navegador: a "requisição" é uma chamada de função ao núcleo, na mesma aba.
    const core = await getCore();
    const parsed = new URL(url, "http://local");
    const res = await core.handle({ method, path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), body: body ?? {} });
    status = res.status;
    data = JSON.parse(JSON.stringify(res.body ?? null)); // cópia: a UI não pode mutar o estado do núcleo
  } else {
    const res = await fetch(BASE + url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    data = await res.json().catch(() => ({}));
  }
  if (status >= 400) {
    const issues = (data as { issues?: { path: string[]; message: string }[] }).issues;
    const detail = issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(detail || (data as { error?: string }).error || `HTTP ${status}`);
  }
  return data as T;
}

/** Assina um stream ao vivo (SSE no servidor; evento direto no navegador). Devolve o cancelamento. */
export function subscribeStream(url: string, onMessage: (data: unknown) => void, onStatus: (connected: boolean) => void): () => void {
  let cancel = () => {};
  let closed = false;
  void getMode().then(async (mode) => {
    if (closed) return;
    if (mode === "browser") {
      const core = await getCore();
      if (closed) return;
      // Entrega assíncrona e com cópia, como aconteceria pela rede.
      const stop = core.subscribe(url, (data) => {
        const copy = JSON.parse(JSON.stringify(data));
        queueMicrotask(() => onMessage(copy));
      });
      onStatus(Boolean(stop));
      cancel = () => stop?.();
    } else {
      const es = new EventSource(BASE + url);
      es.onopen = () => onStatus(true);
      es.onerror = () => onStatus(false);
      es.onmessage = (e) => {
        try {
          onMessage(JSON.parse(e.data));
        } catch {
          /* ignora eventos malformados */
        }
      };
      cancel = () => es.close();
    }
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

export interface CompareResult {
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
}
export interface Comparison {
  id: string;
  input: string;
  startedAt: string;
  done: boolean;
  results: CompareResult[];
}
export interface ComparisonSummary {
  id: string;
  input: string;
  startedAt: string;
  count: number;
  done: boolean;
}
