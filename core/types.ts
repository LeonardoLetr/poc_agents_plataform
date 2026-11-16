// Tipos de domínio do núcleo.
// Campos opcionais aceitam `undefined` explícito: são preenchidos a partir de entradas validadas (Zod) e podem ser limpos.

export type Provider = "anthropic" | "openai" | "demo";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Uma "LLM" configurada em tempo de execução: provedor + modelo + credenciais.
 * Vários agentes podem compartilhar a mesma LLM, e a LLM de um agente pode ser trocada a qualquer momento.
 */
export type LlmConfig = {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  /** Nunca é devolvida pela API — só `apiKeySet`/`apiKeyHint`. */
  apiKey?: string | undefined;
  /** Opcional. Anthropic: proxy/gateway. OpenAI-compatível: ex. https://openrouter.ai/api/v1 */
  baseUrl?: string | undefined;
  /** Só Anthropic: esforço de raciocínio. */
  effort: Effort;
  /** Só Anthropic: fallback no servidor quando o modelo recusa. */
  refusalFallback: boolean;
  maxTokens: number;
  /** Janela de contexto em tokens. Opcional: sem valor, usa o catálogo (ou um padrão por provedor). */
  contextWindow?: number | undefined;
  createdAt: string;
  updatedAt: string;
};

export type AgentConfig = {
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
    /** Inclui memórias episódicas no recall automático (padrão: não). */
    recallEpisodes?: boolean | undefined;
  };
  /** Gestão da janela de contexto: resumo automático do histórico ao passar do limite. */
  context?:
    | {
        autoCompact: boolean;
        /** Percentual da janela que dispara o resumo. */
        thresholdPct: number;
      }
    | undefined;
  createdAt: string;
  updatedAt: string;
};

export const MEMORY_KINDS = ["fact", "preference", "procedure", "episode"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type Memory = {
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
};

/** http: servidor remoto · builtin: servidor embutido que roda em memória. */
export type McpTransport = "http" | "builtin";

export type McpServerConfig = {
  id: string;
  name: string; // usado no prefixo das ferramentas: mcp__<name>__<tool>
  transport: McpTransport;
  /** builtin: nome do servidor embutido. */
  command?: string | undefined;
  args?: string[] | undefined;
  url?: string | undefined;
  headers?: Record<string, string> | undefined;
  /** HTTP: quem abre a conexão. "anthropic" = a API do Claude conecta durante a execução (sem CORS). */
  via?: "client" | "anthropic" | undefined;
  /**
   * Servidores conectados pela Anthropic: ferramentas conhecidas pela plataforma, descobertas sob demanda
   * ("discovered") ou registradas quando um agente as usou ("used").
   */
  knownTools?: { name: string; description?: string | undefined; source: "discovered" | "used" }[] | undefined;
  enabled: boolean;
  createdAt: string;
};

export type PromptTemplate = {
  id: string;
  name: string;
  description: string;
  content: string;
  category: "system" | "task";
  createdAt: string;
};

/** Consumo de tokens de uma chamada (ou de uma execução). */
export type Usage = {
  input: number;
  output: number;
  cacheRead?: number | undefined;
  cacheWrite?: number | undefined;
};

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
  | "agent.delegated"
  | "agent.delegation_finished"
  | "context.compacted"
  | "memory.recalled"
  | "memory.created"
  | "memory.updated"
  | "memory.deleted"
  | "mcp.connected"
  | "mcp.disconnected"
  | "mcp.error"
  | "config.changed";

export type AuditEntry = {
  id: string;
  ts: string;
  type: AuditType;
  actor: "user" | "agent" | "system";
  agentId?: string | undefined;
  runId?: string | undefined;
  summary: string;
  data?: unknown;
  durationMs?: number | undefined;
  tokens?: Usage | undefined;
};

/** Eventos ao vivo de uma execução (enviados via SSE para a UI). */
export type RunEvent =
  | { type: "run.started"; runId: string; agentId: string; input: string; provider: Provider; model: string; llmName: string }
  | { type: "memory.recalled"; memories: { id: string; content: string; score: number; kind: MemoryKind }[] }
  | { type: "iteration.started"; iteration: number }
  | { type: "llm.request"; iteration: number; messageCount: number; toolCount: number; systemPrompt: string }
  | { type: "thinking.delta"; text: string }
  | { type: "text.delta"; text: string }
  | { type: "llm.response"; iteration: number; stopReason: string | null; usage: Usage; durationMs: number; model: string }
  | {
      type: "tool.call";
      id: string;
      name: string;
      input: unknown;
      source: "builtin" | "mcp" | "server" | "agent";
      server?: string | undefined;
    }
  | { type: "tool.approval_requested"; id: string; name: string; input: unknown }
  | { type: "tool.approval_resolved"; id: string; approved: boolean }
  | { type: "tool.result"; id: string; name: string; output: string; isError: boolean; durationMs: number }
  | { type: "delegation.started"; toolUseId: string; childRunId: string; agentId: string; agentName: string; task: string }
  | {
      type: "delegation.finished";
      toolUseId: string;
      childRunId: string;
      status: RunStatus;
      iterations: number;
      usage: { input: number; output: number };
    }
  | {
      type: "context.measured";
      iteration: number;
      /** Tokens de entrada da chamada (inclui leitura e escrita de cache). */
      tokens: number;
      window: number;
      cacheRead: number;
      /** Estimativa por parte do contexto (caracteres / 4). */
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
  | { type: "citations"; items: { url: string; title: string | null; citedText: string }[] }
  | { type: "memory.created"; memory: Memory }
  | { type: "user.message"; text: string }
  | {
      type: "run.completed";
      output: string;
      iterations: number;
      usage: { input: number; output: number };
      childUsage?: { input: number; output: number } | undefined;
    }
  | { type: "run.failed"; error: string }
  | { type: "run.cancelled" };

export type RunStatus = "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";

export type RunRecord = {
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
  /** LLM usada nesta execução (pode diferir da LLM configurada no agente, ex.: em comparações). */
  llmId?: string | undefined;
  /** Agrupa execuções disparadas juntas pela tela de comparação. */
  comparisonId?: string | undefined;
  /** Multiagente: execução que delegou esta (e a chamada de ferramenta correspondente). */
  parentRunId?: string | undefined;
  parentToolUseId?: string | undefined;
  /** Profundidade na cadeia de delegação (0 = execução iniciada pelo usuário). */
  depth?: number | undefined;
  /** Agentes da cadeia, do primeiro ao atual (proteção contra delegação circular). */
  chain?: string[] | undefined;
  /** Execuções filhas iniciadas por esta. */
  childRunIds?: string[] | undefined;
  /** Última medição da janela de contexto. */
  context?: { tokens: number; window: number } | undefined;
  /** Resumos do histórico já feitos nesta execução. */
  compactions?: { iteration: number; tokensBefore: number; messagesBefore: number; at: string }[] | undefined;
  /** Tokens consumidos pelas execuções filhas (inclui as netas). */
  childUsage?: { input: number; output: number } | undefined;
};
