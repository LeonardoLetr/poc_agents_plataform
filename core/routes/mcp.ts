import { z } from "zod";
import { turnText } from "../agent/turn.js";
import { audit } from "../audit.js";
import { callLlm, friendlyLlmError, llmHasCredentials } from "../llm/index.js";
import { callMcpTool, connect, disconnect, forget, publicState } from "../mcp/manager.js";
import { db, persist } from "../store.js";
import { DISCOVERY_PROMPT, isRemoteMcp, mergeKnownTools, parseDiscoveredTools, serverDefinition } from "../mcp/remote.js";
import { type McpServerConfig } from "../types.js";
import { clip, errorMessage, now, uid } from "../util.js";
import { defineRoutes, HttpError, notFound } from "./http.js";

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

export const mcpRoutes = defineRoutes((route) => {
  route("GET", "/api/mcp", () => db.mcpServers.map(mcpView));

  route(
    "POST",
    "/api/mcp",
    async (_p, req) => {
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
    },
    { created: true },
  );

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
      for (const a of db.agents)
        a.tools = a.tools.map((t) => (t.startsWith(prefix) ? `mcp__${server.name}__${t.slice(prefix.length)}` : t));
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
});
