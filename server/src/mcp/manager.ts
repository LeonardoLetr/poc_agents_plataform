import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { audit } from "../audit.js";
import { bus } from "../bus.js";
import type { McpServerConfig } from "../types.js";
import { clip, errorMessage, now } from "../util.js";

/**
 * Gerencia conexões com servidores MCP. Cada servidor expõe ferramentas que
 * viram ferramentas do agente com o nome `mcp__<servidor>__<ferramenta>`.
 */

export type McpStatus = "disconnected" | "connecting" | "connected" | "error";

export interface McpToolInfo {
  name: string; // nome original no servidor
  qualifiedName: string; // nome exposto ao LLM
  description: string;
  inputSchema: Record<string, unknown>;
}

interface Connection {
  status: McpStatus;
  client?: Client;
  transport?: Transport;
  tools: McpToolInfo[];
  error?: string;
  serverInfo?: { name: string; version: string };
  instructions?: string;
  connectedAt?: string;
  logs: string[];
}

const connections = new Map<string, Connection>();

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
export const qualify = (server: string, tool: string) => `mcp__${sanitize(server)}__${sanitize(tool)}`.slice(0, 64);

function conn(id: string): Connection {
  let c = connections.get(id);
  if (!c) {
    c = { status: "disconnected", tools: [], logs: [] };
    connections.set(id, c);
  }
  return c;
}

function log(id: string, line: string) {
  const c = conn(id);
  c.logs.push(`[${new Date().toLocaleTimeString("pt-BR")}] ${line}`);
  if (c.logs.length > 200) c.logs.splice(0, c.logs.length - 200);
}

function emitStatus(id: string) {
  bus.emit("mcp", { id, ...publicState(id) });
}

export function publicState(id: string) {
  const c = conn(id);
  return {
    status: c.status,
    error: c.error,
    tools: c.tools,
    serverInfo: c.serverInfo,
    instructions: c.instructions,
    connectedAt: c.connectedAt,
    logs: c.logs.slice(-50),
  };
}

function buildTransport(cfg: McpServerConfig): Transport {
  if (cfg.transport === "stdio") {
    if (!cfg.command) throw new Error("Comando obrigatório para transporte stdio.");
    const t = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: { ...getDefaultEnvironment(), ...(cfg.env ?? {}) },
      stderr: "pipe",
    });
    t.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) log(cfg.id, `stderr: ${line}`);
    });
    return t;
  }
  if (!cfg.url) throw new Error("URL obrigatória para transporte HTTP.");
  return new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers ?? {} } });
}

export async function connect(cfg: McpServerConfig): Promise<void> {
  await disconnect(cfg.id, false);
  const c = conn(cfg.id);
  c.status = "connecting";
  c.error = undefined;
  log(cfg.id, `Conectando via ${cfg.transport}…`);
  emitStatus(cfg.id);

  const started = Date.now();
  try {
    let client = new Client({ name: "agent-lab", version: "0.1.0" });
    let transport = buildTransport(cfg);
    try {
      await client.connect(transport);
    } catch (err) {
      // Servidores HTTP antigos só falam SSE: tenta o transporte legado.
      if (cfg.transport !== "http") throw err;
      log(cfg.id, "Streamable HTTP falhou, tentando SSE legado…");
      client = new Client({ name: "agent-lab", version: "0.1.0" });
      transport = new SSEClientTransport(new URL(cfg.url!), { requestInit: { headers: cfg.headers ?? {} } });
      await client.connect(transport);
    }

    const { tools } = await client.listTools();
    c.client = client;
    c.transport = transport;
    c.tools = tools.map((t) => ({
      name: t.name,
      qualifiedName: qualify(cfg.name, t.name),
      description: t.description ?? "",
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    }));
    const info = client.getServerVersion();
    c.serverInfo = info ? { name: info.name, version: info.version } : undefined;
    c.instructions = client.getInstructions();
    c.status = "connected";
    c.connectedAt = now();
    log(cfg.id, `Conectado. ${c.tools.length} ferramentas descobertas.`);

    transport.onclose = () => {
      if (c.client === client) {
        c.status = "disconnected";
        c.client = undefined;
        log(cfg.id, "Conexão encerrada pelo servidor.");
        emitStatus(cfg.id);
      }
    };

    audit({
      type: "mcp.connected",
      actor: "system",
      summary: `MCP "${cfg.name}" conectado (${c.tools.length} ferramentas)`,
      durationMs: Date.now() - started,
      data: { server: cfg.name, serverInfo: c.serverInfo, tools: c.tools.map((t) => t.name) },
    });
  } catch (err) {
    c.status = "error";
    c.error = errorMessage(err);
    log(cfg.id, `Erro: ${c.error}`);
    audit({ type: "mcp.error", actor: "system", summary: `Falha ao conectar MCP "${cfg.name}": ${c.error}`, data: { server: cfg.name } });
  }
  emitStatus(cfg.id);
}

export async function disconnect(id: string, record = true): Promise<void> {
  const c = connections.get(id);
  if (!c?.client) return;
  const client = c.client;
  c.client = undefined;
  c.status = "disconnected";
  c.tools = [];
  try {
    await client.close();
  } catch {
    /* ignora */
  }
  log(id, "Desconectado.");
  if (record) audit({ type: "mcp.disconnected", actor: "user", summary: `MCP desconectado`, data: { id } });
  emitStatus(id);
}

export function forget(id: string) {
  connections.delete(id);
}

/** Todas as ferramentas MCP disponíveis agora, já no formato da API da Anthropic. */
export function allMcpTools(servers: McpServerConfig[]): { server: McpServerConfig; tool: McpToolInfo; definition: Anthropic.Tool }[] {
  const out: { server: McpServerConfig; tool: McpToolInfo; definition: Anthropic.Tool }[] = [];
  for (const server of servers) {
    const c = connections.get(server.id);
    if (c?.status !== "connected") continue;
    for (const tool of c.tools) {
      out.push({
        server,
        tool,
        definition: {
          name: tool.qualifiedName,
          description: `[MCP: ${server.name}] ${tool.description}`.slice(0, 1024),
          input_schema: { type: "object", ...tool.inputSchema } as Anthropic.Tool.InputSchema,
        },
      });
    }
  }
  return out;
}

export async function callMcpTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const c = connections.get(serverId);
  if (!c?.client || c.status !== "connected") throw new Error("Servidor MCP não está conectado.");
  log(serverId, `→ ${toolName}(${clip(JSON.stringify(args), 200)})`);
  const result = await c.client.callTool({ name: toolName, arguments: args });
  const parts: string[] = [];
  const content = (result.content ?? []) as { type: string; text?: string; mimeType?: string; resource?: { uri: string; text?: string } }[];
  for (const block of content) {
    if (block.type === "text") parts.push(block.text ?? "");
    else if (block.type === "resource") parts.push(block.resource?.text ?? `[recurso ${block.resource?.uri}]`);
    else parts.push(`[conteúdo ${block.type}${block.mimeType ? ` ${block.mimeType}` : ""} omitido]`);
  }
  if (result.structuredContent && parts.length === 0) parts.push(JSON.stringify(result.structuredContent));
  const text = parts.join("\n") || "(sem conteúdo)";
  log(serverId, `← ${toolName}: ${clip(text, 200)}`);
  return { text, isError: Boolean(result.isError) };
}

export function resolveMcpTool(qualifiedName: string, servers: McpServerConfig[]) {
  for (const server of servers) {
    const c = connections.get(server.id);
    const tool = c?.tools.find((t) => t.qualifiedName === qualifiedName);
    if (tool) return { server, tool };
  }
  return null;
}
