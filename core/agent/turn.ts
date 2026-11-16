import type Anthropic from "@anthropic-ai/sdk";
import type { Block } from "../llm/types.js";

/** Decisões sobre um turno do modelo, sem efeitos: o loop agêntico age conforme o que estas funções devolvem. */

export const toolUsesOf = (content: Block[]) => content.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use");

/**
 * Texto do turno. Blocos de texto consecutivos (divididos por citações) são unidos diretamente;
 * blocos separados por chamadas de ferramenta de servidor viram parágrafos.
 */
export function turnText(content: { type: string; text?: string }[]): string {
  let out = "";
  let prev: string | null = null;
  for (const b of content) {
    if (b.type === "thinking" || b.type === "redacted_thinking") continue;
    if (b.type === "text") out += (out && prev !== "text" ? "\n\n" : "") + (b.text ?? "");
    prev = b.type;
  }
  return out;
}

/**
 * Resposta final: quando o turno usou ferramentas de servidor, o texto anterior a elas é preâmbulo
 * ("vou buscar…") e fica só na linha do tempo; a resposta é o texto depois do último resultado.
 */
export function answerText(content: { type: string; text?: string }[], fallback: string): string {
  const visible = content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
  const lastTool = visible.map((b) => b.type).lastIndexOf(visible.filter((b) => b.type !== "text").at(-1)?.type ?? "");
  if (lastTool < 0) return fallback;
  const after = turnText(visible.slice(lastTool + 1));
  return after.trim() ? after : fallback;
}

export type TurnOutcome =
  /** O modelo terminou: `text` é a resposta final. */
  | { kind: "final"; text: string }
  /** O modelo pediu ferramentas locais: executar e devolver os resultados. */
  | { kind: "tools"; toolUses: Anthropic.Beta.BetaToolUseBlockParam[] }
  /** O servidor pausou o turno das ferramentas de servidor: reenviar retoma de onde parou. */
  | { kind: "resume"; carried: string }
  | { kind: "failed"; error: string };

/**
 * O que fazer depois de um turno. `carried` é o texto de turnos pausados anteriores, que entra na resposta final.
 */
export function turnOutcome(turn: { content: Block[]; stopReason: string | null }, carried: string): TurnOutcome {
  const toolUses = toolUsesOf(turn.content);
  const text = [carried, turnText(turn.content)].filter(Boolean).join("\n\n");
  if (turn.stopReason === "refusal") return { kind: "failed", error: "O modelo recusou a solicitação (stop_reason: refusal)." };
  if (turn.stopReason === "pause_turn") return { kind: "resume", carried: text };
  if (turn.stopReason === "max_tokens" && toolUses.length) return { kind: "failed", error: "Entrada de ferramenta truncada (max_tokens)." };
  if (toolUses.length) return { kind: "tools", toolUses };
  return { kind: "final", text: answerText(turn.content, text) };
}
