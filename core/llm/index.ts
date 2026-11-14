import type { LlmConfig } from "../types.js";
import { anthropicHasCredentials, callAnthropic, friendlyAnthropicError } from "./anthropic.js";
import { demoTurn } from "./demo.js";
import { callOpenAi, openaiHasCredentials } from "./openai.js";
import type { AssistantTurn, LlmCall } from "./types.js";

export type { AssistantTurn, LlmCall, Msg } from "./types.js";

/** Despacha a chamada para o provedor configurado na LLM. */
export function callLlm(call: LlmCall): Promise<AssistantTurn> {
  switch (call.llm.provider) {
    case "anthropic":
      return callAnthropic(call);
    case "openai":
      return callOpenAi(call);
    case "demo":
      return demoTurn(call);
  }
}

export function llmHasCredentials(llm: LlmConfig): boolean {
  if (llm.provider === "demo") return true;
  if (llm.provider === "anthropic") return anthropicHasCredentials(llm);
  return openaiHasCredentials(llm);
}

export function friendlyLlmError(err: unknown): string | null {
  return friendlyAnthropicError(err);
}

/** Versão da LLM segura para devolver pela API: a chave nunca sai, só uma dica. */
export function publicLlm(llm: LlmConfig) {
  const { apiKey, ...rest } = llm;
  return {
    ...rest,
    apiKeySet: Boolean(apiKey),
    apiKeyHint: apiKey ? `…${apiKey.slice(-4)}` : null,
    ready: llmHasCredentials(llm),
  };
}
