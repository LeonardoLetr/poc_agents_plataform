import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { isRecord, now } from "./util.js";

/**
 * Dados do núcleo, descritos como esquemas: os tipos saem deles (`z.infer`), e os mesmos esquemas validam o que
 * vem do armazenamento e de arquivos importados. Campos opcionais aceitam `undefined` explícito.
 *
 * Campos acrescentados depois da primeira versão têm valor padrão, para dados salvos antes deles continuarem válidos.
 */

/** Data de criação ou alteração; dados das primeiras versões podem não ter. */
const Timestamp = z.string().default(now);

export const PROVIDERS = ["anthropic", "openai", "demo"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/**
 * Uma "LLM" configurada em tempo de execução: provedor + modelo + credenciais.
 * Vários agentes podem compartilhar a mesma LLM, e a LLM de um agente pode ser trocada a qualquer momento.
 */
export const LlmConfig = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(PROVIDERS),
  model: z.string(),
  /** Nunca é devolvida pela API — só `apiKeySet`/`apiKeyHint`. */
  apiKey: z.string().optional(),
  /** Opcional. Anthropic: proxy/gateway. OpenAI-compatível: ex. https://openrouter.ai/api/v1 */
  baseUrl: z.string().optional(),
  /** Só Anthropic: esforço de raciocínio. */
  effort: z.enum(EFFORTS).default("medium"),
  /** Só Anthropic: fallback no servidor quando o modelo recusa. */
  refusalFallback: z.boolean().default(true),
  maxTokens: z.number().default(64000),
  /** Janela de contexto em tokens. Opcional: sem valor, usa o catálogo (ou um padrão por provedor). */
  contextWindow: z.number().optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type LlmConfig = z.infer<typeof LlmConfig>;

export const AgentConfig = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string().default("🤖"),
  color: z.string().default("#2563eb"),
  description: z.string().default(""),
  /** Qual LLM este agente usa. */
  llmId: z.string(),
  systemPrompt: z.string().default(""),
  /** Nomes das ferramentas habilitadas (builtin ou `mcp__servidor__tool`). */
  tools: z.array(z.string()).default([]),
  maxIterations: z.number().default(10),
  /** Pausa antes de cada chamada de ferramenta aguardando aprovação humana. */
  requireApproval: z.boolean().default(false),
  memory: z
    .object({
      /** Injeta memórias relevantes no prompt de sistema antes de rodar. */
      autoRecall: z.boolean(),
      /** Salva um resumo (memória episódica) ao fim de cada execução. */
      autoEpisode: z.boolean(),
      recallLimit: z.number(),
      /** Inclui memórias episódicas no recall automático (padrão: não). */
      recallEpisodes: z.boolean().optional(),
    })
    .default({ autoRecall: true, autoEpisode: true, recallLimit: 5 }),
  /** Gestão da janela de contexto: resumo automático do histórico ao passar do limite. */
  context: z
    .object({
      autoCompact: z.boolean(),
      /** Percentual da janela que dispara o resumo. */
      thresholdPct: z.number(),
    })
    .optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export const MEMORY_KINDS = ["fact", "preference", "procedure", "episode"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const Memory = z.object({
  id: z.string(),
  /** null = memória compartilhada entre todos os agentes. */
  agentId: z.string().nullable().default(null),
  kind: z.enum(MEMORY_KINDS),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  /** De 1 a 5. */
  importance: z.number().default(3),
  accessCount: z.number().default(0),
  createdAt: Timestamp,
  lastAccessedAt: z.string().nullable().default(null),
  source: z.enum(["user", "agent", "auto"]).default("user"),
});
export type Memory = z.infer<typeof Memory>;

/** http: servidor remoto · builtin: servidor embutido que roda em memória. */
export type McpTransport = "http" | "builtin";

export const McpServerConfig = z.object({
  id: z.string(),
  /** Usado no prefixo das ferramentas: mcp__<name>__<tool>. */
  name: z.string(),
  transport: z.enum(["http", "builtin"]),
  /** builtin: nome do servidor embutido. */
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  /** HTTP: quem abre a conexão. "anthropic" = a API do Claude conecta durante a execução (sem CORS). */
  via: z.enum(["client", "anthropic"]).optional(),
  /**
   * Servidores conectados pela Anthropic: ferramentas conhecidas pela plataforma, descobertas sob demanda
   * ("discovered") ou registradas quando um agente as usou ("used").
   */
  knownTools: z
    .array(z.object({ name: z.string(), description: z.string().optional(), source: z.enum(["discovered", "used"]) }))
    .optional(),
  enabled: z.boolean().default(true),
  createdAt: Timestamp,
});
export type McpServerConfig = z.infer<typeof McpServerConfig>;

export const PromptTemplate = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  content: z.string(),
  category: z.enum(["system", "task"]).default("task"),
  createdAt: Timestamp,
});
export type PromptTemplate = z.infer<typeof PromptTemplate>;

/** Consumo de tokens de uma chamada (ou de uma execução). */
const Usage = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
});
export type Usage = z.infer<typeof Usage>;
const Tokens = z.object({ input: z.number(), output: z.number() });

export const AUDIT_TYPES = [
  "run.started",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "llm.request",
  "llm.response",
  "tool.call",
  "tool.result",
  "tool.approval_requested",
  "tool.approval_resolved",
  "agent.delegated",
  "agent.delegation_finished",
  "context.compacted",
  "memory.recalled",
  "memory.created",
  "memory.updated",
  "memory.deleted",
  "mcp.connected",
  "mcp.disconnected",
  "mcp.error",
  "config.changed",
] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export const AuditEntry = z.object({
  id: z.string(),
  ts: z.string(),
  type: z.enum(AUDIT_TYPES),
  actor: z.enum(["user", "agent", "system"]),
  agentId: z.string().optional(),
  runId: z.string().optional(),
  summary: z.string(),
  data: z.unknown().optional(),
  durationMs: z.number().optional(),
  tokens: Usage.optional(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const RUN_STATUSES = ["running", "awaiting_approval", "completed", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Eventos ao vivo de uma execução (transmitidos para a interface e guardados no histórico da execução). */
export const RunEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run.started"),
    runId: z.string(),
    agentId: z.string(),
    input: z.string(),
    provider: z.enum(PROVIDERS),
    model: z.string(),
    llmName: z.string().default(""),
  }),
  z.object({
    type: z.literal("memory.recalled"),
    memories: z.array(z.object({ id: z.string(), content: z.string(), score: z.number(), kind: z.enum(MEMORY_KINDS) })),
  }),
  z.object({ type: z.literal("iteration.started"), iteration: z.number() }),
  z.object({
    type: z.literal("llm.request"),
    iteration: z.number(),
    messageCount: z.number(),
    toolCount: z.number(),
    systemPrompt: z.string(),
  }),
  z.object({ type: z.literal("thinking.delta"), text: z.string() }),
  z.object({ type: z.literal("text.delta"), text: z.string() }),
  z.object({
    type: z.literal("llm.response"),
    iteration: z.number(),
    stopReason: z.string().nullable(),
    usage: Usage,
    durationMs: z.number(),
    model: z.string(),
  }),
  z.object({
    type: z.literal("tool.call"),
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
    source: z.enum(["builtin", "mcp", "server", "agent"]),
    server: z.string().optional(),
  }),
  z.object({ type: z.literal("tool.approval_requested"), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({ type: z.literal("tool.approval_resolved"), id: z.string(), approved: z.boolean() }),
  z.object({
    type: z.literal("tool.result"),
    id: z.string(),
    name: z.string(),
    output: z.string(),
    isError: z.boolean(),
    durationMs: z.number(),
  }),
  z.object({
    type: z.literal("delegation.started"),
    toolUseId: z.string(),
    childRunId: z.string(),
    agentId: z.string(),
    agentName: z.string(),
    task: z.string(),
  }),
  z.object({
    type: z.literal("delegation.finished"),
    toolUseId: z.string(),
    childRunId: z.string(),
    status: z.enum(RUN_STATUSES),
    iterations: z.number(),
    usage: Tokens,
  }),
  z.object({
    type: z.literal("context.measured"),
    iteration: z.number(),
    /** Tokens de entrada da chamada (inclui leitura e escrita de cache). */
    tokens: z.number(),
    window: z.number(),
    cacheRead: z.number(),
    /** Estimativa por parte do contexto (caracteres / 4). */
    breakdown: z.object({ system: z.number(), tools: z.number(), history: z.number() }),
    messageCount: z.number(),
  }),
  z.object({
    type: z.literal("context.compacted"),
    iteration: z.number(),
    tokensBefore: z.number(),
    tokensAfter: z.number(),
    messagesBefore: z.number(),
    summary: z.string(),
    thresholdPct: z.number(),
  }),
  z.object({
    type: z.literal("citations"),
    items: z.array(z.object({ url: z.string(), title: z.string().nullable(), citedText: z.string() })),
  }),
  z.object({ type: z.literal("memory.created"), memory: Memory }),
  z.object({ type: z.literal("user.message"), text: z.string() }),
  z.object({
    type: z.literal("run.completed"),
    output: z.string(),
    iterations: z.number(),
    usage: Tokens,
    childUsage: Tokens.optional(),
  }),
  z.object({ type: z.literal("run.failed"), error: z.string() }),
  z.object({ type: z.literal("run.cancelled") }),
]);
export type RunEvent = z.infer<typeof RunEvent>;
export const StoredRunEvent = z.intersection(RunEvent, z.object({ ts: z.string(), seq: z.number() }));

/**
 * Mensagem do histórico, no formato da API da Anthropic. A verificação é rasa (papel e conteúdo): os blocos
 * vieram da própria API ou foram montados pelo núcleo, e repetir aqui o esquema completo do SDK só o duplicaria.
 */
const Message = z.custom<Anthropic.Beta.BetaMessageParam>(
  (m) => isRecord(m) && (m.role === "user" || m.role === "assistant") && (typeof m.content === "string" || Array.isArray(m.content)),
  "Mensagem do histórico fora do formato da API",
);

export const RunRecord = z.object({
  id: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  input: z.string(),
  status: z.enum(RUN_STATUSES),
  output: z.string().nullable(),
  error: z.string().nullable(),
  iterations: z.number(),
  usage: Tokens,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  events: z.array(StoredRunEvent),
  /** Histórico exato enviado ao LLM (a "janela de contexto"). */
  messages: z.array(Message),
  systemPrompt: z.string(),
  scratchpad: z.array(z.string()).default([]),
  /** LLM usada nesta execução (pode diferir da LLM configurada no agente, ex.: em comparações). */
  llmId: z.string().optional(),
  /** Agrupa execuções disparadas juntas pela tela de comparação. */
  comparisonId: z.string().optional(),
  /** Multiagente: execução que delegou esta (e a chamada de ferramenta correspondente). */
  parentRunId: z.string().optional(),
  parentToolUseId: z.string().optional(),
  /** Profundidade na cadeia de delegação (0 = execução iniciada pelo usuário). */
  depth: z.number().optional(),
  /** Agentes da cadeia, do primeiro ao atual (proteção contra delegação circular). */
  chain: z.array(z.string()).optional(),
  /** Execuções filhas iniciadas por esta. */
  childRunIds: z.array(z.string()).optional(),
  /** Última medição da janela de contexto. */
  context: z.object({ tokens: z.number(), window: z.number() }).optional(),
  /** Resumos do histórico já feitos nesta execução. */
  compactions: z
    .array(z.object({ iteration: z.number(), tokensBefore: z.number(), messagesBefore: z.number(), at: z.string() }))
    .optional(),
  /** Tokens consumidos pelas execuções filhas (inclui as netas). */
  childUsage: Tokens.optional(),
});
export type RunRecord = z.infer<typeof RunRecord>;
