import type Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig, LlmConfig, RunEvent, RunRecord } from "../types.js";

/** O histórico é sempre guardado no formato de mensagens da Anthropic; outros provedores convertem. */
export type Msg = Anthropic.Beta.BetaMessageParam;
export type Block = Anthropic.Beta.BetaContentBlockParam;

export interface LlmCall {
  llm: LlmConfig;
  agent: AgentConfig;
  run: RunRecord;
  system: string;
  messages: Msg[];
  tools: Anthropic.Tool[];
  signal: AbortSignal;
  emit: (ev: RunEvent) => void;
}

export interface AssistantTurn {
  content: Block[];
  stopReason: string | null;
  usage: { input: number; output: number; cacheRead?: number };
  model: string;
}
