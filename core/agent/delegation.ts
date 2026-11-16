import type Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig } from "../types.js";

/**
 * Multiagente: um agente pode usar outros agentes como ferramentas.
 *
 * A ferramenta `agent__<id>` inicia uma execução filha do agente indicado, com o próprio loop,
 * LLM, ferramentas e memória. A resposta final da filha volta ao agente pai como `tool_result`.
 */

export const AGENT_TOOL_PREFIX = "agent__";
/** Profundidade máxima: usuário → agente (0) → filha (1) → neta (2). */
export const MAX_DELEGATION_DEPTH = 2;

export const isAgentTool = (name: string) => name.startsWith(AGENT_TOOL_PREFIX);
export const agentToolName = (agentId: string) => `${AGENT_TOOL_PREFIX}${agentId}`;
export const agentIdFromTool = (name: string) => name.slice(AGENT_TOOL_PREFIX.length);

export function agentToolDefinition(agent: AgentConfig): Anthropic.Tool {
  const about = agent.description.trim() ? ` ${agent.description.trim()}` : "";
  return {
    name: agentToolName(agent.id),
    description:
      `Delega uma subtarefa ao agente "${agent.name}".${about} ` +
      "Ele executa o próprio loop, com as ferramentas e a memória dele, e devolve a resposta final. " +
      "Envie uma tarefa completa e autocontida: ele não vê esta conversa.",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Subtarefa completa, com todo o contexto necessário para executá-la." },
      },
      required: ["task"],
    },
  };
}

/** Motivo para recusar a delegação, ou null quando ela é permitida. */
export function delegationBlocked(chain: string[], depth: number, target: AgentConfig): string | null {
  if (depth >= MAX_DELEGATION_DEPTH)
    return `Profundidade máxima de delegação (${MAX_DELEGATION_DEPTH}) atingida. Resolva esta parte sem delegar.`;
  if (chain.includes(target.id)) return `Delegação circular bloqueada: "${target.name}" já está na cadeia desta execução.`;
  return null;
}
