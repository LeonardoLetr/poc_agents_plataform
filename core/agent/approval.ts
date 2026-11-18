import type { AgentConfig } from "../types.js";

/** Política de execução de uma ferramenta: executar direto, pedir aprovação humana antes ou nunca oferecer. */
export type ToolPolicy = AgentConfig["toolPolicies"][string];

/**
 * Regra da ferramenta; se não houver, a do servidor MCP de onde ela vem (`mcp__<servidor>__*`); se não houver, o padrão
 * do agente.
 */
export function policyFor(agent: Pick<AgentConfig, "requireApproval" | "toolPolicies">, name: string): ToolPolicy {
  const own = agent.toolPolicies[name];
  if (own) return own;
  const server = /^mcp__(.+?)__/.exec(name)?.[1];
  const ofServer = server === undefined ? undefined : agent.toolPolicies[`mcp__${server}__*`];
  return ofServer ?? (agent.requireApproval ? "ask" : "allow");
}

/**
 * Ferramentas executadas pela Anthropic rodam dentro da chamada ao modelo, sem pausa possível: "pedir aprovação" vale
 * como permitir, e só o bloqueio tem efeito.
 */
export const isBlocked = (agent: Pick<AgentConfig, "requireApproval" | "toolPolicies">, name: string) => policyFor(agent, name) === "block";
