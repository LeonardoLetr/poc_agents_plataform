// Tipos de domínio compartilhados pelo servidor.

export type Provider = "anthropic" | "openai" | "demo";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Uma "LLM" configurada em tempo de execução: provedor + modelo + credenciais.
 * Vários agentes podem compartilhar a mesma LLM, e a LLM de um agente pode ser trocada a qualquer momento.
 */
export interface LlmConfig {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  /** Nunca é devolvida pela API — só `apiKeySet`/`apiKeyHint`. */
  apiKey?: string;
  /** Opcional. Anthropic: proxy/gateway. OpenAI-compatível: ex. https://openrouter.ai/api/v1 */
  baseUrl?: string;
  /** Só Anthropic: esforço de raciocínio. */
  effort: Effort;
  /** Só Anthropic: fallback no servidor quando o modelo recusa. */
  refusalFallback: boolean;
  maxTokens: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  emoji: string;
  color: string;
  description: string;
  /** Qual LLM este agente usa. */
  llmId: string;
  systemPrompt: string;
  /** Nomes das ferramentas habilitadas (builtin ou `mcp__servidor__tool`). */
  tools: string[];
  maxIterations: number;
  /** Pausa antes de cada chamada de ferramenta aguardando aprovação humana. */
  requireApproval: boolean;
  memory: {
    /** Injeta memórias relevantes no prompt de sistema antes de rodar. */
    autoRecall: boolean;
    /** Salva um resumo (memória episódica) ao fim de cada execução. */
    autoEpisode: boolean;
    recallLimit: number;
  };
  createdAt: string;
  updatedAt: string;
}

export type MemoryKind = "fact" | "episode" | "preference" | "procedure";

export interface Memory {
  id: string;
  /** null = memória compartilhada entre todos os agentes. */
  agentId: string | null;
  kind: MemoryKind;
  content: string;
  tags: string[];
  importance: number; // 1..5
  accessCount: number;
  createdAt: string;
  lastAccessedAt: string | null;
  source: "user" | "agent" | "auto";
}

/** stdio: processo local (só no modo servidor) · http: servidor remoto · builtin: servidor embutido que roda em memória. */
export type McpTransport = "stdio" | "http" | "builtin";

export interface McpServerConfig {
  id: string;
  name: string; // usado no prefixo das ferramentas: mcp__<name>__<tool>
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  createdAt: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  category: "system" | "task";
  createdAt: string;
}

export type AuditType =
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "llm.request"
  | "llm.response"
  | "tool.call"
  | "tool.result"
  | "tool.approval_requested"
  | "tool.approval_resolved"
  | "memory.recalled"
  | "memory.created"
  | "memory.updated"
  | "memory.deleted"
  | "mcp.connected"
  | "mcp.disconnected"
  | "mcp.error"
  | "config.changed";

export interface AuditEntry {
  id: string;
  ts: string;
  type: AuditType;
  actor: "user" | "agent" | "system";
  agentId?: string;
  runId?: string;
  summary: string;
  data?: unknown;
  durationMs?: number;
  tokens?: { input: number; output: number; cacheRead?: number };
}

/** Eventos ao vivo de uma execução (enviados via SSE para a UI). */
export type RunEvent =
  | { type: "run.started"; runId: string; agentId: string; input: string; provider: Provider; model: string; llmName: string }
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
  | { type: "run.cancelled" };

export type RunStatus = "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";

export interface RunRecord {
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
  events: (RunEvent & { ts: string; seq: number })[];
  /** Histórico exato enviado ao LLM (a "janela de contexto"). */
  messages: unknown[];
  systemPrompt: string;
  scratchpad: string[];
}
