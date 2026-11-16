import Anthropic from "@anthropic-ai/sdk";
import type { LlmConfig } from "../types.js";
import { describeMcpResult, MCP_CONNECTOR_BETA } from "../mcp/remote.js";
import { describeServerResult, isServerToolResult } from "../tools/server.js";
import { supportsServerFallback } from "./catalog.js";
import type { AssistantTurn, Block, LlmCall } from "./types.js";

const clients = new Map<string, Anthropic>();

function clientFor(llm: LlmConfig): Anthropic {
  const key = `${llm.apiKey ?? ""}|${llm.baseUrl ?? ""}`;
  let client = clients.get(key);
  if (!client) {
    client = new Anthropic({
      apiKey: llm.apiKey,
      ...(llm.baseUrl ? { baseURL: llm.baseUrl } : {}),
      // A chave fica no navegador de quem usa a plataforma; o SDK exige consentimento explícito para isso.
      dangerouslyAllowBrowser: true,
    });
    clients.set(key, client);
  }
  return client;
}

export function anthropicHasCredentials(llm: LlmConfig) {
  return Boolean(llm.apiKey);
}

export async function callAnthropic(call: LlmCall): Promise<AssistantTurn> {
  const { llm, emit } = call;
  const useFallback = llm.refusalFallback && supportsServerFallback(llm.model);
  const mcp = call.mcpServers ?? [];
  const betas = [...(useFallback ? ["server-side-fallback-2026-07-01"] : []), ...(mcp.length ? [MCP_CONNECTOR_BETA] : [])];
  const params = {
    model: llm.model,
    max_tokens: llm.maxTokens || 64000,
    system: call.system,
    messages: call.messages,
    tools: [...(call.tools as Anthropic.Beta.BetaToolUnion[]), ...(call.serverTools ?? [])],
    // Pensamento adaptativo com resumo, exibido na linha do tempo.
    thinking: { type: "adaptive" as const, display: "summarized" as const },
    output_config: { effort: llm.effort },
    // Cache automático do prefixo: no loop agêntico o histórico cresce e é reenviado a cada iteração.
    cache_control: { type: "ephemeral" as const },
    ...(useFallback ? { fallbacks: "default" } : {}),
    ...(mcp.length ? { mcp_servers: mcp } : {}),
    ...(betas.length ? { betas } : {}),
  };
  const stream = clientFor(llm).beta.messages.stream(params as Parameters<Anthropic["beta"]["messages"]["stream"]>[0], {
    signal: call.signal,
  });
  // Texto que volta depois de um bloco de ferramenta de servidor começa em novo parágrafo.
  let lastBlock: string | null = null;
  let emittedText = false;
  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_start") {
      const type = event.content_block.type;
      if (type === "text" && emittedText && lastBlock !== "text") emit({ type: "text.delta", text: "\n\n" });
      if (type !== "thinking" && type !== "redacted_thinking") lastBlock = type;
      return;
    }
    if (event.type !== "content_block_delta") return;
    const d = event.delta as { type: string; text?: string; thinking?: string };
    if (d.type === "text_delta" && d.text) {
      emittedText = true;
      emit({ type: "text.delta", text: d.text });
    } else if (d.type === "thinking_delta" && d.thinking) emit({ type: "thinking.delta", text: d.thinking });
  });
  // Ferramentas de servidor: a chamada e o resultado chegam como blocos completos durante o streaming.
  const serverCalls = new Map<string, { name: string; started: number }>();
  stream.on("contentBlock", (block) => {
    const b = block as unknown as { type: string; id?: string; name?: string; input?: unknown; tool_use_id?: string };
    if (b.type === "mcp_tool_use" && b.id && b.name) {
      // Ferramenta de um servidor MCP executada pela Anthropic: mesmo nome qualificado das ferramentas MCP locais.
      const server = (block as unknown as { server_name: string }).server_name;
      serverCalls.set(b.id, { name: `mcp__${server}__${b.name}`, started: Date.now() });
      emit({ type: "tool.call", id: b.id, name: `mcp__${server}__${b.name}`, input: b.input ?? {}, source: "mcp", server });
    } else if (b.type === "mcp_tool_result" && b.tool_use_id) {
      const info = serverCalls.get(b.tool_use_id);
      const { output, isError } = describeMcpResult(block as unknown as { content?: unknown; is_error?: boolean });
      emit({
        type: "tool.result",
        id: b.tool_use_id,
        name: info?.name ?? "mcp",
        output,
        isError,
        durationMs: info ? Date.now() - info.started : 0,
      });
    } else if (b.type === "server_tool_use" && b.id && b.name) {
      serverCalls.set(b.id, { name: b.name, started: Date.now() });
      emit({ type: "tool.call", id: b.id, name: b.name, input: b.input ?? {}, source: "server" });
    } else if (isServerToolResult(b)) {
      const id = b.tool_use_id;
      const callInfo = serverCalls.get(id);
      const { output, isError } = describeServerResult(b);
      emit({
        type: "tool.result",
        id,
        name: callInfo?.name ?? b.type.replace(/_tool_result$/, ""),
        output,
        isError,
        durationMs: callInfo ? Date.now() - callInfo.started : 0,
      });
    }
  });
  const msg = await stream.finalMessage();
  return {
    content: msg.content as unknown as Block[],
    stopReason: msg.stop_reason,
    usage: {
      input: msg.usage.input_tokens,
      output: msg.usage.output_tokens,
      cacheRead: msg.usage.cache_read_input_tokens ?? undefined,
      cacheWrite: msg.usage.cache_creation_input_tokens ?? undefined,
    },
    model: msg.model,
  };
}

export function friendlyAnthropicError(err: unknown): string | null {
  if (err instanceof Anthropic.AuthenticationError) return "Chave da API inválida (401). Verifique a LLM em “LLMs”.";
  if (err instanceof Anthropic.RateLimitError) return "Limite de requisições atingido (429). Tente novamente em instantes.";
  if (err instanceof Anthropic.APIConnectionError) return `Não foi possível conectar à API da Anthropic: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Erro da API (${err.status ?? "?"}): ${err.message}`;
  return null;
}
