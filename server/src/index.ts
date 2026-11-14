import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { audit } from "./audit.js";
import { bus } from "./bus.js";
import { MODELS, PRICING, hasCredentials } from "./agent/llm.js";
import { cancelRun, continueRun, resolveApproval, startRun } from "./agent/runner.js";
import { allMcpTools, callMcpTool, connect, disconnect, forget, publicState } from "./mcp/manager.js";
import { createMemory, deleteMemory, searchMemories } from "./memory.js";
import { db, persist } from "./store.js";
import { builtinTools } from "./tools/builtin.js";
import type { AgentConfig, AuditEntry, McpServerConfig, PromptTemplate } from "./types.js";
import { now, uid } from "./util.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Execuções interrompidas por um reinício do servidor não continuam sozinhas.
for (const r of db.runs) {
  if (r.status === "running" || r.status === "awaiting_approval") {
    r.status = "failed";
    r.error = "Servidor reiniciado durante a execução.";
    r.finishedAt = now();
  }
}

const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

function sse(res: Response) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  res.on("close", () => clearInterval(ping));
  return (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ───────────────────────── Sistema ─────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, anthropicConfigured: hasCredentials(), models: MODELS, keySource: db.settings.anthropicApiKey ? "ui" : hasCredentials() ? "env" : null });
});

app.put("/api/settings", (req, res) => {
  const body = z.object({ anthropicApiKey: z.string().optional() }).parse(req.body);
  db.settings.anthropicApiKey = body.anthropicApiKey?.trim() || undefined;
  persist();
  audit({ type: "config.changed", actor: "user", summary: body.anthropicApiKey ? "Chave da API atualizada" : "Chave da API removida" });
  res.json({ ok: true, anthropicConfigured: hasCredentials() });
});

app.get("/api/stats", (_req, res) => {
  const runs = db.runs;
  const tokens = runs.reduce((acc, r) => ({ input: acc.input + r.usage.input, output: acc.output + r.usage.output }), { input: 0, output: 0 });
  const cost = db.runs.reduce((acc, r) => {
    const agent = db.agents.find((a) => a.id === r.agentId);
    const p = agent ? PRICING[agent.model] : undefined;
    return p ? acc + (r.usage.input * p.input + r.usage.output * p.output) / 1e6 : acc;
  }, 0);
  const toolCalls = db.audit.filter((a) => a.type === "tool.call");
  const toolUsage: Record<string, number> = {};
  for (const t of toolCalls) {
    const name = String((t.summary.match(/Chamou (.+)/) ?? [])[1] ?? "?");
    toolUsage[name] = (toolUsage[name] ?? 0) + 1;
  }
  res.json({
    agents: db.agents.length,
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
  });
});

// ───────────────────────── Ferramentas ─────────────────────────
app.get("/api/tools", (_req, res) => {
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
  res.json([...builtin, ...mcp]);
});

// ───────────────────────── Agentes ─────────────────────────
const AgentInput = z.object({
  name: z.string().min(1).max(60),
  emoji: z.string().max(8).default("🤖"),
  color: z.string().default("#8b5cf6"),
  description: z.string().max(400).default(""),
  provider: z.enum(["anthropic", "demo"]).default("anthropic"),
  model: z.string().default("claude-opus-5-5"),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  systemPrompt: z.string().default(""),
  tools: z.array(z.string()).default([]),
  maxIterations: z.number().int().min(1).max(50).default(10),
  requireApproval: z.boolean().default(false),
  memory: z
    .object({ autoRecall: z.boolean(), autoEpisode: z.boolean(), recallLimit: z.number().int().min(0).max(20) })
    .default({ autoRecall: true, autoEpisode: true, recallLimit: 5 }),
  refusalFallback: z.boolean().default(true),
});

app.get("/api/agents", (_req, res) => res.json(db.agents));
app.get("/api/agents/:id", (req, res) => {
  const agent = db.agents.find((a) => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: "Agente não encontrado" });
  res.json(agent);
});
app.post("/api/agents", (req, res) => {
  const body = AgentInput.parse(req.body);
  const agent: AgentConfig = { id: uid("agt"), ...body, createdAt: now(), updatedAt: now() };
  db.agents.push(agent);
  persist();
  audit({ type: "config.changed", actor: "user", agentId: agent.id, summary: `Agente "${agent.name}" criado`, data: agent });
  res.status(201).json(agent);
});
app.put("/api/agents/:id", (req, res) => {
  const agent = db.agents.find((a) => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: "Agente não encontrado" });
  const body = AgentInput.parse(req.body);
  const before = structuredClone(agent);
  Object.assign(agent, body, { updatedAt: now() });
  persist();
  const changed = Object.keys(body).filter((k) => JSON.stringify((before as never)[k]) !== JSON.stringify((agent as never)[k]));
  audit({ type: "config.changed", actor: "user", agentId: agent.id, summary: `Agente "${agent.name}" atualizado (${changed.join(", ") || "sem mudanças"})`, data: { before, after: agent } });
  res.json(agent);
});
app.delete("/api/agents/:id", (req, res) => {
  const idx = db.agents.findIndex((a) => a.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Agente não encontrado" });
  const [removed] = db.agents.splice(idx, 1);
  persist();
  audit({ type: "config.changed", actor: "user", agentId: removed.id, summary: `Agente "${removed.name}" removido` });
  res.json({ ok: true });
});

// ───────────────────────── Prompts ─────────────────────────
const PromptInput = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  content: z.string().min(1),
  category: z.enum(["system", "task"]).default("system"),
});
app.get("/api/prompts", (_req, res) => res.json(db.prompts));
app.post("/api/prompts", (req, res) => {
  const prompt: PromptTemplate = { id: uid("prm"), ...PromptInput.parse(req.body), createdAt: now() };
  db.prompts.push(prompt);
  persist();
  audit({ type: "config.changed", actor: "user", summary: `Prompt "${prompt.name}" criado` });
  res.status(201).json(prompt);
});
app.put("/api/prompts/:id", (req, res) => {
  const prompt = db.prompts.find((p) => p.id === req.params.id);
  if (!prompt) return res.status(404).json({ error: "Prompt não encontrado" });
  Object.assign(prompt, PromptInput.parse(req.body));
  persist();
  audit({ type: "config.changed", actor: "user", summary: `Prompt "${prompt.name}" atualizado` });
  res.json(prompt);
});
app.delete("/api/prompts/:id", (req, res) => {
  const idx = db.prompts.findIndex((p) => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Prompt não encontrado" });
  const [removed] = db.prompts.splice(idx, 1);
  persist();
  audit({ type: "config.changed", actor: "user", summary: `Prompt "${removed.name}" removido` });
  res.json({ ok: true });
});

// ───────────────────────── Memória ─────────────────────────
app.get("/api/memories", (req, res) => {
  const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
  res.json(agentId ? db.memories.filter((m) => m.agentId === agentId || m.agentId === null) : db.memories);
});
app.get("/api/memories/search", (req, res) => {
  const q = String(req.query.q ?? "");
  const agentId = typeof req.query.agentId === "string" && req.query.agentId ? req.query.agentId : undefined;
  res.json(searchMemories(q, { agentId, limit: 20 }));
});
const MemoryInput = z.object({
  content: z.string().min(1),
  kind: z.enum(["fact", "episode", "preference", "procedure"]).default("fact"),
  tags: z.array(z.string()).default([]),
  importance: z.number().min(1).max(5).default(3),
  agentId: z.string().nullable().default(null),
});
app.post("/api/memories", (req, res) => {
  const body = MemoryInput.parse(req.body);
  res.status(201).json(createMemory({ ...body, source: "user" }));
});
app.put("/api/memories/:id", (req, res) => {
  const memory = db.memories.find((m) => m.id === req.params.id);
  if (!memory) return res.status(404).json({ error: "Memória não encontrada" });
  const before = structuredClone(memory);
  Object.assign(memory, MemoryInput.parse(req.body));
  persist();
  audit({ type: "memory.updated", actor: "user", summary: `Memória editada: ${memory.content.slice(0, 80)}`, data: { before, after: memory } });
  res.json(memory);
});
app.delete("/api/memories/:id", (req, res) => {
  if (!deleteMemory(req.params.id, "user")) return res.status(404).json({ error: "Memória não encontrada" });
  res.json({ ok: true });
});

// ───────────────────────── MCP ─────────────────────────
const McpInput = z.object({
  name: z.string().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/, "Use apenas letras, números, _ e -"),
  transport: z.enum(["stdio", "http"]),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
});
const mcpView = (s: McpServerConfig) => ({ ...s, env: Object.fromEntries(Object.keys(s.env ?? {}).map((k) => [k, "••••"])), state: publicState(s.id) });

app.get("/api/mcp", (_req, res) => res.json(db.mcpServers.map(mcpView)));
app.post("/api/mcp", wrap(async (req, res) => {
  const body = McpInput.parse(req.body);
  if (db.mcpServers.some((s) => s.name === body.name)) return res.status(409).json({ error: "Já existe um servidor com esse nome" });
  const server: McpServerConfig = { id: uid("mcp"), ...body, createdAt: now() };
  db.mcpServers.push(server);
  persist();
  audit({ type: "config.changed", actor: "user", summary: `Servidor MCP "${server.name}" adicionado`, data: { ...server, env: Object.keys(server.env ?? {}) } });
  if (server.enabled) await connect(server);
  res.status(201).json(mcpView(server));
}));
app.post("/api/mcp/:id/connect", wrap(async (req, res) => {
  const server = db.mcpServers.find((s) => s.id === req.params.id);
  if (!server) return res.status(404).json({ error: "Servidor não encontrado" });
  server.enabled = true;
  persist();
  await connect(server);
  res.json(mcpView(server));
}));
app.post("/api/mcp/:id/disconnect", wrap(async (req, res) => {
  const server = db.mcpServers.find((s) => s.id === req.params.id);
  if (!server) return res.status(404).json({ error: "Servidor não encontrado" });
  server.enabled = false;
  persist();
  await disconnect(server.id);
  res.json(mcpView(server));
}));
app.delete("/api/mcp/:id", wrap(async (req, res) => {
  const idx = db.mcpServers.findIndex((s) => s.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Servidor não encontrado" });
  const [removed] = db.mcpServers.splice(idx, 1);
  await disconnect(removed.id, false);
  forget(removed.id);
  persist();
  audit({ type: "config.changed", actor: "user", summary: `Servidor MCP "${removed.name}" removido` });
  res.json({ ok: true });
}));
app.post("/api/mcp/:id/tools/:tool/call", wrap(async (req, res) => {
  const server = db.mcpServers.find((s) => s.id === req.params.id);
  if (!server) return res.status(404).json({ error: "Servidor não encontrado" });
  const started = Date.now();
  const tool = String(req.params.tool);
  const args = (req.body?.arguments ?? {}) as Record<string, unknown>;
  try {
    const result = await callMcpTool(server.id, tool, args);
    audit({ type: "tool.call", actor: "user", summary: `Chamou mcp__${server.name}__${tool} (teste manual)`, durationMs: Date.now() - started, data: { args, result } });
    res.json({ ...result, durationMs: Date.now() - started });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
}));
app.get("/api/mcp/events", (req, res) => {
  const send = sse(res);
  const onMcp = (e: unknown) => send(e);
  bus.on("mcp", onMcp);
  req.on("close", () => bus.off("mcp", onMcp));
});

// ───────────────────────── Execuções ─────────────────────────
app.get("/api/runs", (req, res) => {
  const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
  const list = db.runs.filter((r) => !agentId || r.agentId === agentId).slice(-50).reverse();
  res.json(list.map(({ events, messages, ...rest }) => ({ ...rest, eventCount: events.length, messageCount: messages.length })));
});
app.post("/api/runs", (req, res) => {
  const body = z.object({ agentId: z.string(), input: z.string().min(1) }).parse(req.body);
  const agent = db.agents.find((a) => a.id === body.agentId);
  if (!agent) return res.status(404).json({ error: "Agente não encontrado" });
  const run = startRun(agent, body.input);
  res.status(201).json({ id: run.id });
});
app.get("/api/runs/:id", (req, res) => {
  const run = db.runs.find((r) => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: "Execução não encontrada" });
  res.json(run);
});
app.get("/api/runs/:id/stream", (req, res) => {
  const run = db.runs.find((r) => r.id === req.params.id);
  if (!run) return res.status(404).json({ error: "Execução não encontrada" });
  const send = sse(res);
  // Primeiro reenvia o histórico, depois transmite ao vivo.
  send({ type: "snapshot", run: { ...run, events: undefined, messages: undefined }, events: run.events });
  const onEvent = (e: unknown) => send(e);
  bus.on(`run:${run.id}`, onEvent);
  req.on("close", () => bus.off(`run:${run.id}`, onEvent));
});
app.post("/api/runs/:id/messages", (req, res) => {
  const { text } = z.object({ text: z.string().min(1) }).parse(req.body);
  try {
    continueRun(String(req.params.id), text);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
app.post("/api/runs/:id/cancel", (req, res) => res.json({ ok: cancelRun(String(req.params.id)) }));
app.post("/api/runs/:id/approve", (req, res) => {
  const { toolUseId, approved } = z.object({ toolUseId: z.string(), approved: z.boolean() }).parse(req.body);
  res.json({ ok: resolveApproval(String(req.params.id), toolUseId, approved) });
});

// ───────────────────────── Auditoria ─────────────────────────
function filterAudit(q: Request["query"]): AuditEntry[] {
  const types = typeof q.type === "string" && q.type ? q.type.split(",") : null;
  const text = typeof q.q === "string" ? q.q.toLowerCase() : "";
  return db.audit.filter(
    (a) =>
      (!types || types.some((t) => a.type === t || a.type.startsWith(`${t}.`))) &&
      (!q.agentId || a.agentId === q.agentId) &&
      (!q.runId || a.runId === q.runId) &&
      (!q.actor || a.actor === q.actor) &&
      (!text || a.summary.toLowerCase().includes(text)),
  );
}
app.get("/api/audit", (req, res) => {
  const limit = Math.min(1000, Number(req.query.limit ?? 300));
  const list = filterAudit(req.query);
  res.json({ total: list.length, entries: list.slice(-limit).reverse() });
});
app.get("/api/audit/export", (req, res) => {
  res.setHeader("content-disposition", `attachment; filename="auditoria-${Date.now()}.json"`);
  res.json(filterAudit(req.query));
});
app.get("/api/audit/stream", (req, res) => {
  const send = sse(res);
  const onAudit = (e: unknown) => send(e);
  bus.on("audit", onAudit);
  req.on("close", () => bus.off("audit", onAudit));
});

// ───────────────────────── Front-end (build de produção) ─────────────────────────
const webDist = path.resolve(process.cwd(), "../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: "Dados inválidos", issues: err.issues });
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : "Erro interno" });
});

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  console.log(`\n  🧪 Agent Lab API em http://localhost:${PORT}`);
  console.log(`  Claude: ${hasCredentials() ? "credenciais encontradas ✔" : "sem chave — use o agente demo ou configure ANTHROPIC_API_KEY"}\n`);
  // Reconecta os servidores MCP habilitados.
  for (const s of db.mcpServers.filter((s) => s.enabled)) void connect(s);
});
