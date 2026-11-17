import type { PromptTemplate } from "./api";

/** Prompts de tarefa: atalhos do Playground com `{{variáveis}}` preenchidas antes de usar o texto. */

const VARIAVEL = /\{\{\s*([\p{L}\p{N}_]+)\s*\}\}/gu;

/** Variáveis do texto, na ordem em que aparecem e sem repetir. */
export function promptVariables(content: string): string[] {
  return [...new Set([...content.matchAll(VARIAVEL)].flatMap((m) => (m[1] ? [m[1]] : [])))];
}

/** Texto com as variáveis substituídas; as que ainda não têm valor continuam como `{{nome}}`. */
export function fillPrompt(content: string, values: Readonly<Record<string, string>>): string {
  return content.replace(VARIAVEL, (whole, name: string) => values[name]?.trim() || whole);
}

/** Rótulo do campo: "valor_mensal" → "Valor mensal". */
export const variableLabel = (name: string) => {
  const text = name.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Atalhos de tarefa do agente: os ligados a ele e os que valem para todos (lista de agentes vazia). */
export function taskPromptsFor(prompts: readonly PromptTemplate[], agentId: string): PromptTemplate[] {
  return prompts.filter((p) => p.category === "task" && (p.agentIds.length === 0 || p.agentIds.includes(agentId)));
}
