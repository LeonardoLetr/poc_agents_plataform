import type Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig, LlmConfig, McpServerConfig } from "../types.js";

/**
 * Servidores MCP conectados pela API do Claude (conector MCP).
 *
 * Em vez de o Agent Lab abrir a conexão (o que no navegador depende de CORS), o servidor vai junto na
 * requisição ao modelo e a própria Anthropic se conecta a ele, descobre as ferramentas e as executa.
 * Só funciona com LLMs Anthropic e servidores HTTP públicos.
 */

export const MCP_CONNECTOR_BETA = "mcp-client-2025-11-20";

/** Servidor MCP conectado pela API da Anthropic, que precisa de uma URL pública. */
export type RemoteMcpServer = McpServerConfig & { url: string };

export const isRemoteMcp = (s: McpServerConfig): s is RemoteMcpServer =>
  s.transport === "http" && s.via === "anthropic" && typeof s.url === "string";

/** A API aceita um token de autorização: extraído do cabeçalho Authorization ("Bearer <token>" ou só o token). */
export function authorizationToken(headers: Record<string, string> = {}): string | undefined {
  const value = Object.entries(headers)
    .find(([k]) => k.toLowerCase() === "authorization")?.[1]
    ?.trim();
  if (!value) return undefined;
  return value.replace(/^bearer\s+/i, "") || undefined;
}

/** Cabeçalhos além do Authorization não chegam ao servidor por este caminho. */
export const ignoredHeaders = (headers: Record<string, string> = {}) =>
  Object.keys(headers).filter((k) => k.toLowerCase() !== "authorization");

/** Definição do servidor para o parâmetro `mcp_servers` da API. */
export function serverDefinition(s: RemoteMcpServer): Anthropic.Beta.BetaRequestMCPServerURLDefinition {
  const token = authorizationToken(s.headers);
  return { type: "url", name: s.name, url: s.url, ...(token ? { authorization_token: token } : {}) };
}

/**
 * Servidores e conjuntos de ferramentas a enviar na requisição. Com `mcp__<servidor>__*` todas as ferramentas ficam
 * disponíveis; com nomes individuais, só elas (as demais ficam desligadas).
 */
export function remoteMcpFor(
  agent: AgentConfig,
  llm: LlmConfig,
  servers: McpServerConfig[],
): { servers: Anthropic.Beta.BetaRequestMCPServerURLDefinition[]; toolsets: Anthropic.Beta.BetaMCPToolset[]; ignored: string[] } {
  const wanted = servers.filter(isRemoteMcp).filter((s) => s.enabled && agent.tools.some((t) => t.startsWith(`mcp__${s.name}__`)));
  if (llm.provider !== "anthropic") return { servers: [], toolsets: [], ignored: wanted.map((s) => s.name) };
  const defs: Anthropic.Beta.BetaRequestMCPServerURLDefinition[] = [];
  const toolsets: Anthropic.Beta.BetaMCPToolset[] = [];
  for (const s of wanted) {
    defs.push(serverDefinition(s));
    const all = agent.tools.includes(`mcp__${s.name}__*`);
    const only = agent.tools
      .filter((t) => t.startsWith(`mcp__${s.name}__`) && !t.endsWith("__*"))
      .map((t) => t.slice(`mcp__${s.name}__`.length));
    toolsets.push(
      all || !only.length
        ? { type: "mcp_toolset", mcp_server_name: s.name }
        : {
            type: "mcp_toolset",
            mcp_server_name: s.name,
            default_config: { enabled: false },
            configs: Object.fromEntries(only.map((t) => [t, { enabled: true }])),
          },
    );
  }
  return { servers: defs, toolsets, ignored: [] };
}

/** Texto do resultado de uma ferramenta MCP executada pela Anthropic. */
export function describeMcpResult(block: Anthropic.Beta.BetaMCPToolResultBlock): { output: string; isError: boolean } {
  const text = typeof block.content === "string" ? block.content : block.content.map((b) => b.text).join("\n");
  return { output: text.length > 4000 ? `${text.slice(0, 3999)}…` : text, isError: block.is_error };
}

type KnownTool = NonNullable<McpServerConfig["knownTools"]>[number];

/** Registra uma ferramenta usada por um agente (sem custo). Devolve true se a lista mudou. */
export function rememberUsedTool(server: McpServerConfig, toolName: string): boolean {
  const list = (server.knownTools ??= []);
  if (list.some((t) => t.name === toolName)) return false;
  list.push({ name: toolName, source: "used" });
  return true;
}

export const DISCOVERY_PROMPT =
  "Liste todas as ferramentas do servidor MCP disponíveis para você nesta conversa. " +
  "Responda somente com um JSON entre <tools></tools>, no formato " +
  '[{"name": "nome_exato_da_ferramenta", "description": "uma frase em português"}]. ' +
  "Use os nomes exatamente como aparecem para você, sem prefixos. Não chame nenhuma ferramenta.";

/** Lê a lista devolvida pelo modelo. Aceita o JSON entre <tools></tools> ou o primeiro array JSON do texto. */
export function parseDiscoveredTools(text: string): { name: string; description?: string }[] {
  const raw = text.match(/<tools>([\s\S]*?)<\/tools>/i)?.[1] ?? text.match(/\[[\s\S]*\]/)?.[0];
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const items: unknown[] = data;
    const out: { name: string; description?: string }[] = [];
    for (const item of items) {
      const fields = typeof item === "object" && item !== null ? item : {};
      const name = typeof item === "string" ? item : "name" in fields ? fields.name : undefined;
      if (typeof name !== "string" || !/^[\w.-]{1,128}$/.test(name)) continue;
      const description = "description" in fields && typeof fields.description === "string" ? fields.description.slice(0, 240) : undefined;
      if (!out.some((t) => t.name === name)) out.push({ name, ...(description ? { description } : {}) });
    }
    return out;
  } catch {
    return [];
  }
}

/** Junta a lista descoberta com a atual: ferramentas já usadas continuam marcadas como usadas. */
export function mergeKnownTools(current: KnownTool[] = [], discovered: { name: string; description?: string }[]): KnownTool[] {
  const merged: KnownTool[] = discovered.map((d) => ({
    ...d,
    source: current.find((c) => c.name === d.name)?.source === "used" ? "used" : "discovered",
  }));
  for (const c of current) if (c.source === "used" && !merged.some((m) => m.name === c.name)) merged.push(c);
  return merged;
}
