import type Anthropic from "@anthropic-ai/sdk";
import type { LlmConfig, RunEvent, Usage } from "../types.js";

/** O histórico é sempre guardado no formato de mensagens da Anthropic; outros provedores convertem. */
export type Msg = Anthropic.Beta.BetaMessageParam;
export type Block = Anthropic.Beta.BetaContentBlockParam;

export type LlmCall = {
  llm: LlmConfig;
  /** Pedido original da execução: a LLM demo o usa quando o histórico não traz o texto do usuário. */
  input: string;
  system: string;
  messages: Msg[];
  tools: Anthropic.Tool[];
  /** Ferramentas de servidor (web_search, web_fetch): só o provedor Anthropic as envia; os demais ignoram. */
  serverTools?: Anthropic.Beta.BetaToolUnion[] | undefined;
  /** Servidores MCP conectados pela API do Claude (só o provedor Anthropic envia). */
  mcpServers?: Anthropic.Beta.BetaRequestMCPServerURLDefinition[] | undefined;
  signal: AbortSignal;
  emit: (ev: RunEvent) => void;
};

export type AssistantTurn = {
  content: Block[];
  stopReason: string | null;
  usage: Usage;
  model: string;
};
