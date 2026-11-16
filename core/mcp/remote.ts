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

export const isRemoteMcp = (s: McpServerConfig) => s.transport === "http" && s.via === "anthropic";

/** A API aceita um token de autorização: extraído do cabeçalho Authorization ("Bearer <token>" ou só o token). */
export function authorizationToken(headers: Record<string, string> = {}): string | undefined {
  const value = Object.entries(headers).find(([k]) => k.toLowerCase() === "authorization")?.[1]?.trim();
  if (!value) return undefined;
  return value.replace(/^bearer\s+/i, "") || undefined;
}

/** Cabeçalhos além do Authorization não chegam ao servidor por este caminho. */
export const ignoredHeaders = (headers: Record<string, string> = {}) => Object.keys(headers).filter((k) => k.toLowerCase() !== "authorization");

/**
 * Servidores e conjuntos de ferramentas a enviar na requisição. Com `mcp__<servidor>__*` todas as ferramentas ficam
 * disponíveis; com nomes individuais, só elas (as demais ficam desligadas).
 */
export function remoteMcpFor(agent: AgentConfig, llm: LlmConfig, servers: McpServerConfig[]) {
  const wanted = servers.filter((s) => s.enabled && isRemoteMcp(s) && agent.tools.some((t) => t.startsWith(`mcp__${s.name}__`)));
  if (llm.provider !== "anthropic") return { servers: [], toolsets: [], ignored: wanted.map((s) => s.name) };
  const defs: Anthropic.Beta.BetaRequestMCPServerURLDefinition[] = [];
  const toolsets: Anthropic.Beta.BetaMCPToolset[] = [];
  for (const s of wanted) {
    const token = authorizationToken(s.headers);
    defs.push({ type: "url", name: s.name, url: s.url!, ...(token ? { authorization_token: token } : {}) });
    const all = agent.tools.includes(`mcp__${s.name}__*`);
    const only = agent.tools.filter((t) => t.startsWith(`mcp__${s.name}__`) && !t.endsWith("__*")).map((t) => t.slice(`mcp__${s.name}__`.length));
    toolsets.push(
      all || !only.length
        ? { type: "mcp_toolset", mcp_server_name: s.name }
        : { type: "mcp_toolset", mcp_server_name: s.name, default_config: { enabled: false }, configs: Object.fromEntries(only.map((t) => [t, { enabled: true }])) },
    );
  }
  return { servers: defs, toolsets, ignored: [] as string[] };
}

/** Texto do resultado de uma ferramenta MCP executada pela Anthropic. */
export function describeMcpResult(block: { content?: unknown; is_error?: boolean }): { output: string; isError: boolean } {
  const c = block.content;
  const text = typeof c === "string" ? c : Array.isArray(c) ? (c as { type?: string; text?: string }[]).map((b) => b.text ?? "").join("\n") : JSON.stringify(c ?? "");
  return { output: text.length > 4000 ? `${text.slice(0, 3999)}…` : text, isError: Boolean(block.is_error) };
}
