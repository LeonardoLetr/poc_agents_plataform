// Tipos espelhados do servidor + cliente HTTP mínimo.

export type Provider = "anthropic" | "demo";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Agent {
  id: string;
  name: string;
  emoji: string;
  color: string;
  description: string;
  provider: Provider;
  model: string;
  effort: Effort;
  systemPrompt: string;
  tools: string[];
  maxIterations: number;
  requireApproval: boolean;
  memory: { autoRecall: boolean; autoEpisode: boolean; recallLimit: number };
  refusalFallback: boolean;
  createdAt: string;
  updatedAt: string;
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
  source: "builtin" | "mcp";
  server?: string;
  category: string;
}

export interface McpServer {
  id: string;
  name: string;
  transport: "stdio" | "http";
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

export type RunEvent = { ts: string } & (
  | { type: "run.started"; runId: string; agentId: string; input: string; provider: Provider; model: string }
  | { type: "memory.recalled"; memories: { id: string; content: string; score: number; kind: MemoryKind }[] }
  | { type: "iteration.started"; iteration: number }
  | { type: "llm.request"; iteration: number; messageCount: number; toolCount: number; systemPrompt: string }
  | { type: "thinking.delta"; text: string }
  | { type: "text.delta"; text: string }
  | { type: "llm.response"; iteration: number; stopReason: string | null; usage: { input: number; output: number; cacheRead?: number }; durationMs: number; model: string }
  | { type: "tool.call"; id: string; name: string; input: unknown; source: "builtin" | "mcp"; server?: string }
  | { type: "tool.approval_requested"; id: string; name: string; input: unknown }
  | { type: "tool.approval_resolved"; id: string; approved: boolean }
  | { type: "tool.result"; id: string; name: string; output: string; isError: boolean; durationMs: number }
  | { type: "memory.created"; memory: Memory }
  | { type: "user.message"; text: string }
  | { type: "run.completed"; output: string; iterations: number; usage: { input: number; output: number } }
  | { type: "run.failed"; error: string }
  | { type: "run.cancelled" }
);

export interface Health {
  ok: boolean;
  anthropicConfigured: boolean;
  keySource: "ui" | "env" | null;
  models: { id: string; label: string; note: string; fallback: boolean }[];
}

export interface Stats {
  agents: number;
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

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issues = (data as { issues?: { path: string[]; message: string }[] }).issues;
    const detail = issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(detail || (data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>("PUT", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};
