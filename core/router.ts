import { z } from "zod";
import { cancelRun, continueRun, resolveApproval, startRun } from "./agent/runner.js";
import { turnText } from "./agent/turn.js";
import { audit } from "./audit.js";
import { exportConfig, importConfig } from "./backup.js";
import { ANTHROPIC_MODELS, OPENAI_PRESETS, PRICING } from "./llm/catalog.js";
import { callLlm, friendlyLlmError, llmHasCredentials, publicLlm } from "./llm/index.js";
import { BUILTIN_MCP_SERVERS, allMcpTools, callMcpTool, connect, disconnect, forget, publicState } from "./mcp/manager.js";
import { createMemory, deleteMemory, searchMemories } from "./memory.js";
import { newLlm } from "./seed.js";
import { db, persist } from "./store.js";
import { builtinTools } from "./tools/builtin.js";
import { SERVER_TOOLS } from "./tools/server.js";
import { DISCOVERY_PROMPT, isRemoteMcp, mergeKnownTools, parseDiscoveredTools, serverDefinition } from "./mcp/remote.js";
import { agentToolDefinition, agentToolName } from "./agent/delegation.js";
import { MEMORY_KINDS, type AgentConfig, type AuditEntry, type McpServerConfig, type PromptTemplate, type RunRecord } from "./types.js";
import { bus, clip, errorMessage, eventsOfType, now, uid } from "./util.js";

/**
 * A API inteira da plataforma, independente de framework. O servidor Express
 * repassa as requisições HTTP para `handle`; no navegador o cliente chama
 * `handle` direto. Streams (SSE no servidor) passam por `subscribe`.
 */

export type ApiRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
};
export type ApiResponse = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const notFound = (what: string): never => {
  throw new HttpError(404, `${what} não encontrado(a)`);
};

/** Parâmetros de um caminho como "/api/runs/:id/approve" → { id: string }. */
type PathParams<P extends string> = P extends `${string}:${infer Key}/${infer Rest}`
  ? { [K in Key]: string } & PathParams<`/${Rest}`>
  : P extends `${string}:${infer Key}`
    ? { [K in Key]: string }
    : object;

type Handler = (p: Record<string, string>, req: ApiRequest) => unknown;
const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];
function route<P extends string>(method: string, path: P, handler: (p: PathParams<P>, req: ApiRequest) => unknown) {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), "([^/]+)"))}$`);
  // Seguro: o despacho só chama o handler quando o padrão casou, com um valor para cada parâmetro do caminho.
  routes.push({ method, pattern, keys, handler: handler as Handler });
}

// ───────────────────────── Sistema ─────────────────────────
route("GET", "/api/health", () => ({
  ok: true,
  capabilities: { builtinMcp: Object.keys(BUILTIN_MCP_SERVERS) },
  llmsReady: db.llms.filter(llmHasCredentials).length,
  llmsTotal: db.llms.length,
  catalog: { anthropic: ANTHROPIC_MODELS, openai: OPENAI_PRESETS },
}));

route("GET", "/api/stats", () => {
  const runs = db.runs;
  const tokens = runs.reduce((acc, r) => ({ input: acc.input + r.usage.input, output: acc.output + r.usage.output }), {
    input: 0,
    output: 0,
  });
  let cost = 0;
  for (const r of runs) {
    const [started] = eventsOfType(r.events, "run.started");
    const p = started ? PRICING[started.model] : undefined;
    if (p) cost += (r.usage.input * p.input + r.usage.output * p.output) / 1e6;
  }
  const toolCalls = db.audit.filter((a) => a.type === "tool.call");
  const toolUsage: Record<string, number> = {};
  for (const t of toolCalls) {
    const name = t.summary.match(/Chamou (\S+)/)?.[1] ?? "?";
    toolUsage[name] = (toolUsage[name] ?? 0) + 1;
  }
  return {
    agents: db.agents.length,
    llms: db.llms.length,
    runs: runs.length,
    runsByStatus: runs.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {}),
    memories: db.memories.length,
    mcpServers: db.mcpServers.length,
    mcpConnected: db.mcpServers.filter((s) => publicState(s.id).status === "connected").length,
    toolCalls: toolCalls.length,
    toolUsage,
    tokens,
    estimatedCostUsd: +cost.toFixed(4),
    auditEntries: db.audit.length,
  };
});

// ───────────────────────── LLMs ─────────────────────────
const LlmInput = z.object({
  name: z.string().min(1).max(60),
  provider: z.enum(["anthropic", "openai", "demo"]),
  model: z.string().min(1),
  /** undefined = manter a chave atual · "" = remover */
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  refusalFallback: z.boolean().default(true),
  maxTokens: z.number().int().min(256).max(128000).optional(),
  contextWindow: z.number().int().min(1000).max(10_000_000).optional(),
});

route("GET", "/api/llms", () =>
  db.llms.map((l) => ({ ...publicLlm(l), agents: db.agents.filter((a) => a.llmId === l.id).map((a) => a.id) })),
);
route("POST", "/api/llms", (_p, req) => {
  const body = LlmInput.parse(req.body);
  const { maxTokens, ...fields } = body;
  const llm = newLlm({ ...fields, apiKey: body.apiKey?.trim() || undefined, baseUrl: body.baseUrl?.trim() || undefined });
  if (maxTokens) llm.maxTokens = maxTokens;
  db.llms.push(llm);
  persist();
  audit({
    type: "config.changed",
    actor: "user",
    summary: `LLM "${llm.name}" criada (${llm.provider} · ${llm.model})`,
    data: publicLlm(llm),
  });
  return publicLlm(llm);
});
route("PUT", "/api/llms/:id", ({ id }, req) => {
  const llm = db.llms.find((l) => l.id === id) ?? notFound("LLM");
  const body = LlmInput.parse(req.body);
  const before = publicLlm(llm);
  Object.assign(llm, {
    name: body.name,
    provider: body.provider,
    model: body.model,
    baseUrl: body.baseUrl?.trim() || undefined,
    effort: body.effort,
    refusalFallback: body.refusalFallback,
    maxTokens: body.maxTokens ?? llm.maxTokens,
    contextWindow: body.contextWindow,
    updatedAt: now(),
  });
  if (body.apiKey !== undefined) llm.apiKey = body.apiKey.trim() || undefined;
  persist();
  audit({
    type: "config.changed",
    actor: "user",
    summary: `LLM "${llm.name}" atualizada${body.apiKey !== undefined ? (body.apiKey ? " (chave trocada)" : " (chave removida)") : ""}`,
    data: { before, after: publicLlm(llm) },
  });
  return publicLlm(llm);
});
route("DELETE", "/api/llms/:id", ({ id }) => {
  const removed = db.llms.find((l) => l.id === id) ?? notFound("LLM");
  const users = db.agents.filter((a) => a.llmId === id);
  if (users.length)
    throw new HttpError(409, `Esta LLM é usada por: ${users.map((a) => a.name).join(", ")}. Troque a LLM desses agentes antes.`);
  db.llms.splice(db.llms.indexOf(removed), 1);
  persist();
  audit({ type: "config.changed", actor: "user", summary: `LLM "${removed.name}" removida` });
  return { ok: true };
});

// ───────────────────────── Exportação e importação ─────────────────────────
route("GET", "/api/export", () => exportConfig());
route("POST", "/api/import", async (_p, req) => {
  const body = z.object({ data: z.unknown(), mode: z.enum(["merge", "replace"]).default("merge") }).parse(req.body);
  try {
    return await importConfig(body.data, body.mode);
  } catch (err) {
    if (err instanceof z.ZodError) throw err;
    throw new HttpError(400, errorMessage(err));
  }
});

// ───────────────────────── Ferramentas ─────────────────────────
route("GET", "/api/tools", () => {
  const builtin = Object.values(builtinTools).map((t) => ({
    name: t.definition.name,
    description: t.definition.description,
    inputSchema: t.definition.input_schema,
    source: "builtin" as const,
    category: t.category,
  }));
  const mcp = allMcpTools(db.mcpServers).map((t) => ({
    name: t.definition.name,
    description: t.tool.description,
    inputSchema: t.tool.inputSchema,
    source: "mcp" as const,
    server: t.server.name,
    category: "mcp",
  }));
  const server = Object.values(SERVER_TOOLS).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: {},
    source: "server" as const,
    category: t.category,
  }));
  // Servidores MCP conectados pela Anthropic: as ferramentas só são conhecidas durante a execução.
  const remoteMcp = db.mcpServers.filter(isRemoteMcp).flatMap((s) => [
    {
      name: `mcp__${s.name}__*`,
      description: "Ferramentas descobertas e executadas pela API da Anthropic durante a execução (apenas LLMs Anthropic).",
      inputSchema: {},
      source: "mcp" as const,
      server: s.name,
      category: "mcp",
      viaAnthropic: true,
    },
    // Ferramentas já conhecidas (descobertas ou usadas) podem ser habilitadas uma a uma.
    ...(s.knownTools ?? []).map((t) => ({
      name: `mcp__${s.name}__${t.name}`,
      description: t.description ?? "",
      inputSchema: {},
      source: "mcp" as const,
      server: s.name,
      category: "mcp",
      viaAnthropic: true,
    })),
  ]);
  // Outros agentes como ferramentas (multiagente). O editor oculta o próprio agente.
  const agents = db.agents.map((a) => {
    const def = agentToolDefinition(a);
    return {
      name: def.name,
      description: def.description,
      inputSchema: def.input_schema,
      source: "agent" as const,
      category: "agente",
      agentId: a.id,
      label: `${a.emoji} ${a.name}`,
    };
  });
  return [...builtin, ...server, ...agents, ...mcp, ...remoteMcp];
});

// ───────────────────────── Agentes ─────────────────────────
const AgentInput = z.object({
  name: z.string().min(1).max(60),
  emoji: z.string().max(8).default("🤖"),
  color: z.string().default("#8b5cf6"),
  description: z.string().max(400).default(""),
  llmId: z.string().min(1, "Escolha uma LLM"),
  systemPrompt: z.string().default(""),
  tools: z.array(z.string()).default([]),
  maxIterations: z.number().int().min(1).max(50).default(10),
  requireApproval: z.boolean().default(false),
  memory: z
    .object({
      autoRecall: z.boolean(),
      autoEpisode: z.boolean(),
      recallLimit: z.number().int().min(0).max(20),
      recallEpisodes: z.boolean().optional(),
    })
    .default({ autoRecall: true, autoEpisode: true, recallLimit: 5 }),
  context: z.object({ autoCompact: z.boolean(), thresholdPct: z.number().int().min(5).max(95) }).optional(),
});
const checkLlm = (llmId: string) => db.llms.some((l) => l.id === llmId) || notFound("LLM");

route("GET", "/api/agents", () => db.agents);
route("GET", "/api/agents/:id", ({ id }) => db.agents.find((a) => a.id === id) ?? notFound("Agente"));
route("POST", "/api/agents", (_p, req) => {
  const body = AgentInput.parse(req.body);
  checkLlm(body.llmId);
  const agent: AgentConfig = { id: uid("agt"), ...body, createdAt: now(), updatedAt: now() };
  db.agents.push(agent);
  persist();
  audit({ type: "config.changed", actor: "user", agentId: agent.id, summary: `Agente "${agent.name}" criado`, data: agent });
  return agent;
});
route("PUT", "/api/agents/:id", ({ id }, req) => {
  const agent = db.agents.find((a) => a.id === id) ?? notFound("Agente");
  const body = AgentInput.parse(req.body);
  checkLlm(body.llmId);
  body.tools = body.tools.filter((t) => t !== agentToolName(agent.id)); // um agente não delega a si mesmo
  const before = structuredClone(agent);
  Object.assign(agent, body, { updatedAt: now() });
  persist();
  const changed = Object.keys(body).filter((k) => JSON.stringify(Reflect.get(before, k)) !== JSON.stringify(Reflect.get(agent, k)));
  audit({
    type: "config.changed",
    actor: "user",
    agentId: agent.id,
    summary: `Agente "${agent.name}" atualizado (${changed.join(", ") || "sem mudanças"})`,
    data: { before, after: agent },
  });
  return agent;
});
route("DELETE", "/api/agents/:id", ({ id }) => {
  const removed = db.agents.find((a) => a.id === id) ?? notFound("Agente");
  db.agents.splice(db.agents.indexOf(removed), 1);
  // Remove a delegação para o agente excluído dos demais.
  for (const a of db.agents) a.tools = a.tools.filter((t) => t !== agentToolName(removed.id));
  persist();
  audit({ type: "config.changed", actor: "user", agentId: removed.id, summary: `Agente "${removed.name}" removido` });
  return { ok: true };
});

// ───────────────────────── Prompts ─────────────────────────
const PromptInput = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  content: z.string().min(1),
  category: z.enum(["system", "task"]).default("system"),
});
route("GET", "/api/prompts", () => db.prompts);
route("POST", "/api/prompts", (_p, req) => {
  const prompt: PromptTemplate = { id: uid("prm"), ...PromptInput.parse(req.body), createdAt: now() };
  db.prompts.push(prompt);
  persist();
  audit({ type: "config.changed", actor: "user", summary: `Prompt "${prompt.name}" criado` });
  return prompt;
});
route("PUT", "/api/prompts/:id", ({ id }, req) => {
  const prompt = db.prompts.find((p) => p.id === id) ?? notFound("Prompt");
  Object.assign(prompt, PromptInput.parse(req.body));
  persist();
  audit({ type: "config.changed", actor: "user", summary: `Prompt "${prompt.name}" atualizado` });
  return prompt;
});
route("DELETE", "/api/prompts/:id", ({ id }) => {
  const removed = db.prompts.find((p) => p.id === id) ?? notFound("Prompt");
  db.prompts.splice(db.prompts.indexOf(removed), 1);
  persist();
  audit({ type: "config.changed", actor: "user", summary: `Prompt "${removed.name}" removido` });
  return { ok: true };
});

// ───────────────────────── Memória ─────────────────────────
const MemoryInput = z.object({
  content: z.string().min(1),
  kind: z.enum(MEMORY_KINDS).default("fact"),
  tags: z.array(z.string()).default([]),
  importance: z.number().min(1).max(5).default(3),
  agentId: z.string().nullable().default(null),
});
route("GET", "/api/memories", (_p, req) =>
  req.query.agentId ? db.memories.filter((m) => m.agentId === req.query.agentId || m.agentId === null) : db.memories,
);
route("GET", "/api/memories/search", (_p, req) =>
  searchMemories(req.query.q ?? "", { agentId: req.query.agentId || undefined, limit: 20 }),
);
route("POST", "/api/memories", (_p, req) => createMemory({ ...MemoryInput.parse(req.body), source: "user" }));
route("PUT", "/api/memories/:id", ({ id }, req) => {
  const memory = db.memories.find((m) => m.id === id) ?? notFound("Memória");
  const before = structuredClone(memory);
  Object.assign(memory, MemoryInput.parse(req.body));
  persist();
  audit({
    type: "memory.updated",
    actor: "user",
    summary: `Memória editada: ${memory.content.slice(0, 80)}`,
    data: { before, after: memory },
  });
  return memory;
});
route("DELETE", "/api/memories/:id", ({ id }) => (deleteMemory(id, "user") ? { ok: true } : notFound("Memória")));

// ───────────────────────── MCP ─────────────────────────
const McpInput = z.object({
  name: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, "Use apenas letras, números, _ e -"),
  transport: z.enum(["http", "builtin"]),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).default({}),
  via: z.enum(["client", "anthropic"]).optional(),
  enabled: z.boolean().default(true),
});
/** Valores de variáveis e cabeçalhos nunca saem da API. */
const MASK = "••••";
const mcpView = (s: McpServerConfig) => ({
  ...s,
  headers: Object.fromEntries(Object.keys(s.headers ?? {}).map((k) => [k, MASK])),
  state: publicState(s.id),
});
const findServer = (id: string) => db.mcpServers.find((s) => s.id === id) ?? notFound("Servidor MCP");

route("GET", "/api/mcp", () => db.mcpServers.map(mcpView));
route("POST", "/api/mcp", async (_p, req) => {
  const body = McpInput.parse(req.body);
  if (db.mcpServers.some((s) => s.name === body.name)) throw new HttpError(409, "Já existe um servidor com esse nome");
  const server: McpServerConfig = { id: uid("mcp"), ...body, createdAt: now() };
  db.mcpServers.push(server);
  persist();
  audit({
    type: "config.changed",
    actor: "user",
    summary: `Servidor MCP "${server.name}" adicionado`,
    data: { ...server, headers: Object.keys(server.headers ?? {}) },
  });
  if (server.enabled) await connect(server);
  return mcpView(server);
});
/** Edição: valores ocultos ("••••") mantêm o que já estava salvo; renomear atualiza as ferramentas dos agentes. */
route("PUT", "/api/mcp/:id", async ({ id }, req) => {
  const server = findServer(id);
  const body = McpInput.parse(req.body);
  if (body.name !== server.name && db.mcpServers.some((s) => s.name === body.name))
    throw new HttpError(409, "Já existe um servidor com esse nome");
  const keepMasked = (next: Record<string, string>, prev: Record<string, string> = {}) =>
    Object.fromEntries(Object.entries(next).map(([k, v]) => [k, v === MASK ? (prev[k] ?? "") : v]));
  const oldName = server.name;
  Object.assign(server, {
    name: body.name,
    transport: body.transport,
    command: body.command,
    args: body.args,
    url: body.url,
    headers: keepMasked(body.headers, server.headers),
    via: body.via,
    enabled: body.enabled,
  });
  if (oldName !== server.name) {
    const prefix = `mcp__${oldName}__`;
    for (const a of db.agents) a.tools = a.tools.map((t) => (t.startsWith(prefix) ? `mcp__${server.name}__${t.slice(prefix.length)}` : t));
  }
  persist();
  audit({
    type: "config.changed",
    actor: "user",
    summary: `Servidor MCP "${server.name}" atualizado`,
    data: { ...server, headers: Object.keys(server.headers ?? {}) },
  });
  await disconnect(server.id, false);
  if (server.enabled) await connect(server);
  return mcpView(server);
});
/**
 * Servidor conectado pela Anthropic: pede ao Claude a lista de ferramentas que a API disponibilizou para ele.
 * Usa uma LLM Anthropic com chave (a indicada ou a primeira pronta), com esforço baixo.
 */
route("POST", "/api/mcp/:id/discover", async ({ id }, req) => {
  const server = findServer(id);
  if (!isRemoteMcp(server))
    throw new HttpError(
      400,
      "Só servidores conectados pela API da Anthropic precisam de descoberta; os demais listam as ferramentas ao conectar.",
    );
  const wanted = z.object({ llmId: z.string().optional() }).optional().parse(req.body)?.llmId;
  const llm = db.llms.find((l) => l.provider === "anthropic" && llmHasCredentials(l) && (!wanted || l.id === wanted));
  if (!llm) throw new HttpError(400, "Para descobrir as ferramentas é preciso uma LLM Anthropic com chave. Cadastre a chave em “LLMs”.");
  const started = Date.now();
  const turn = await callLlm({
    llm: { ...structuredClone(llm), effort: "low", maxTokens: 4000 },
    input: DISCOVERY_PROMPT,
    system: "Você descreve as ferramentas disponíveis, sem executá-las.",
    messages: [{ role: "user", content: DISCOVERY_PROMPT }],
    tools: [],
    serverTools: [{ type: "mcp_toolset", mcp_server_name: server.name }],
    mcpServers: [serverDefinition(server)],
    signal: AbortSignal.timeout(90_000),
    emit: () => undefined,
  }).catch((err: unknown) => {
    throw new HttpError(502, friendlyLlmError(err) ?? errorMessage(err));
  });
  const text = turnText(turn.content);
  const discovered = parseDiscoveredTools(text);
  if (!discovered.length)
    throw new HttpError(502, `O modelo não devolveu uma lista de ferramentas. Resposta: ${clip(text || "(vazia)", 300)}`);
  server.knownTools = mergeKnownTools(server.knownTools, discovered);
  persist();
  audit({
    type: "config.changed",
    actor: "user",
    summary: `Ferramentas do servidor MCP "${server.name}" descobertas pela API da Anthropic: ${discovered.length}`,
    durationMs: Date.now() - started,
    tokens: turn.usage,
    data: { server: server.name, llm: llm.name, tools: discovered.map((t) => t.name) },
  });
  return mcpView(server);
});
route("POST", "/api/mcp/:id/connect", async ({ id }) => {
  const server = findServer(id);
  server.enabled = true;
  persist();
  await connect(server);
  return mcpView(server);
});
route("POST", "/api/mcp/:id/disconnect", async ({ id }) => {
  const server = findServer(id);
  server.enabled = false;
  persist();
  await disconnect(server.id);
  return mcpView(server);
});
route("DELETE", "/api/mcp/:id", async ({ id }) => {
  const server = findServer(id);
  db.mcpServers.splice(db.mcpServers.indexOf(server), 1);
  // As ferramentas do servidor removido saem dos agentes (senão ficam como referência órfã no grafo).
  const prefix = `mcp__${server.name}__`;
  for (const a of db.agents) a.tools = a.tools.filter((t) => !t.startsWith(prefix));
  await disconnect(server.id, false);
  forget(server.id);
  persist();
  audit({ type: "config.changed", actor: "user", summary: `Servidor MCP "${server.name}" removido` });
  return { ok: true };
});
route("POST", "/api/mcp/:id/tools/:tool/call", async ({ id, tool }, req) => {
  const server = findServer(id);
  const started = Date.now();
  const args =
    z
      .object({ arguments: z.record(z.string(), z.unknown()).default({}) })
      .optional()
      .parse(req.body)?.arguments ?? {};
  try {
    const result = await callMcpTool(server.id, decodeURIComponent(tool), args);
    audit({
      type: "tool.call",
      actor: "user",
      summary: `Chamou mcp__${server.name}__${tool} (teste manual)`,
      durationMs: Date.now() - started,
      data: { args, result },
    });
    return { ...result, durationMs: Date.now() - started };
  } catch (err) {
    throw new HttpError(400, errorMessage(err));
  }
});

// ───────────────────────── Execuções ─────────────────────────
route("GET", "/api/runs", (_p, req) =>
  db.runs
    .filter((r) => !req.query.agentId || r.agentId === req.query.agentId)
    .slice(-50)
    .reverse()
    .map(({ events, messages, ...rest }) => ({ ...rest, eventCount: events.length, messageCount: messages.length })),
);
route("POST", "/api/runs", (_p, req) => {
  const body = z.object({ agentId: z.string(), input: z.string().min(1) }).parse(req.body);
  const agent = db.agents.find((a) => a.id === body.agentId) ?? notFound("Agente");
  try {
    return { id: startRun(agent, body.input).id };
  } catch (err) {
    throw new HttpError(400, errorMessage(err));
  }
});
route("GET", "/api/runs/:id", ({ id }) => db.runs.find((r) => r.id === id) ?? notFound("Execução"));
route("POST", "/api/runs/:id/messages", ({ id }, req) => {
  const { text } = z.object({ text: z.string().min(1) }).parse(req.body);
  try {
    continueRun(id, text);
    return { ok: true };
  } catch (err) {
    throw new HttpError(400, errorMessage(err));
  }
});
route("POST", "/api/runs/:id/cancel", ({ id }) => ({ ok: cancelRun(id) }));
route("POST", "/api/runs/:id/approve", ({ id }, req) => {
  const { toolUseId, approved } = z.object({ toolUseId: z.string(), approved: z.boolean() }).parse(req.body);
  return { ok: resolveApproval(id, toolUseId, approved) };
});

// ───────────────────────── Comparação lado a lado ─────────────────────────
/** Métricas de uma execução, usadas na comparação. Custo só é estimado para modelos com preço conhecido. */
function runMetrics(r: RunRecord) {
  const [started] = eventsOfType(r.events, "run.started");
  const model = started?.model ?? "";
  const price = PRICING[model];
  const toolCalls = eventsOfType(r.events, "tool.call").map((e) => e.name);
  return {
    runId: r.id,
    agentId: r.agentId,
    agentName: r.agentName,
    llmId: r.llmId,
    llmName: started?.llmName ?? "",
    provider: started?.provider ?? "",
    model,
    status: r.status,
    error: r.error,
    output: r.output,
    iterations: r.iterations,
    tokens: { input: r.usage.input, output: r.usage.output, total: r.usage.input + r.usage.output },
    costUsd: price ? +((r.usage.input * price.input + r.usage.output * price.output) / 1e6).toFixed(6) : null,
    durationMs: r.finishedAt ? new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime() : null,
    toolCalls: toolCalls.length,
    tools: [...new Set(toolCalls)],
  };
}

const CompareInput = z.object({
  input: z.string().min(1),
  entries: z
    .array(z.object({ agentId: z.string(), llmId: z.string().optional() }))
    .min(2, "Escolha ao menos 2 combinações")
    .max(4, "No máximo 4 combinações"),
});

route("POST", "/api/compare", (_p, req) => {
  const body = CompareInput.parse(req.body);
  const plan = body.entries.map((e) => {
    const agent = db.agents.find((a) => a.id === e.agentId) ?? notFound("Agente");
    if (e.llmId) checkLlm(e.llmId);
    return { agent, llmId: e.llmId };
  });
  const comparisonId = uid("cmp");
  const runIds = plan.map(({ agent, llmId }) => {
    try {
      return startRun(agent, body.input, { llmId, comparisonId }).id;
    } catch (err) {
      throw new HttpError(400, errorMessage(err));
    }
  });
  audit({
    type: "config.changed",
    actor: "user",
    summary: `Comparação iniciada com ${runIds.length} combinações`,
    data: { comparisonId, input: body.input, entries: body.entries },
  });
  return { id: comparisonId, runIds };
});
route("GET", "/api/compare", () => {
  const groups = new Map<string, RunRecord[]>();
  for (const r of db.runs) if (r.comparisonId) groups.set(r.comparisonId, [...(groups.get(r.comparisonId) ?? []), r]);
  // Cada grupo tem ao menos uma execução: ele só é criado ao encontrar uma.
  return [...groups.entries()]
    .flatMap(([id, runs]) =>
      runs[0]
        ? [{ id, input: runs[0].input, startedAt: runs[0].startedAt, count: runs.length, done: runs.every((r) => r.finishedAt) }]
        : [],
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 20);
});
route("GET", "/api/compare/:id", ({ id }) => {
  const runs = db.runs.filter((r) => r.comparisonId === id);
  const first = runs[0] ?? notFound("Comparação");
  return { id, input: first.input, startedAt: first.startedAt, done: runs.every((r) => r.finishedAt), results: runs.map(runMetrics) };
});

// ───────────────────────── Auditoria ─────────────────────────
function filterAudit(q: Record<string, string>): AuditEntry[] {
  const types = q.type ? q.type.split(",") : null;
  const text = (q.q ?? "").toLowerCase();
  return db.audit.filter(
    (a) =>
      (!types || types.some((t) => a.type === t || a.type.startsWith(`${t}.`))) &&
      (!q.agentId || a.agentId === q.agentId) &&
      (!q.runId || a.runId === q.runId) &&
      (!q.actor || a.actor === q.actor) &&
      (!text || a.summary.toLowerCase().includes(text)),
  );
}
route("GET", "/api/audit", (_p, req) => {
  const limit = Math.min(1000, Number(req.query.limit ?? 300));
  const list = filterAudit(req.query);
  return { total: list.length, entries: list.slice(-limit).reverse() };
});
route("GET", "/api/audit/export", (_p, req) => filterAudit(req.query));

// ───────────────────────── Despacho ─────────────────────────
export async function handle(req: ApiRequest): Promise<ApiResponse> {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.pattern.exec(req.path);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1] ?? "")]));
    try {
      const body = await r.handler(params, req);
      return {
        status:
          req.method === "POST" && !req.path.match(/\/(connect|disconnect|cancel|approve|messages|call|discover|import)$/) ? 201 : 200,
        body,
      };
    } catch (err) {
      if (err instanceof z.ZodError) return { status: 400, body: { error: "Dados inválidos", issues: err.issues } };
      if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
      console.error(err);
      return { status: 500, body: { error: errorMessage(err) } };
    }
  }
  return { status: 404, body: { error: `Rota não encontrada: ${req.method} ${req.path}` } };
}

/**
 * Streams ao vivo. Devolve a função de cancelamento, ou null se o caminho não for um stream.
 *  - /api/runs/:id/stream → snapshot + eventos da execução
 *  - /api/audit/stream    → novos registros de auditoria
 *  - /api/mcp/events      → mudanças de status dos servidores MCP
 */
export function subscribe(path: string, send: (data: unknown) => void): (() => void) | null {
  const run = path.match(/^\/api\/runs\/([^/]+)\/stream$/);
  if (run) {
    const record = db.runs.find((r) => r.id === run[1]);
    if (!record) return null;
    send({ type: "snapshot", run: { ...record, events: undefined, messages: undefined }, events: record.events });
    return bus.on(`run:${record.id}`, send);
  }
  if (path === "/api/audit/stream") return bus.on("audit", send);
  if (path === "/api/mcp/events") return bus.on("mcp", send);
  return null;
}
