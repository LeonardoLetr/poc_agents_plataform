import type { LlmConfig } from "../types.js";
import type { AssistantTurn, Block, LlmCall, Msg } from "./types.js";

/**
 * Provedores compatíveis com a API de Chat Completions (OpenAI, OpenRouter,
 * Groq, Ollama). O histórico interno usa o formato da Anthropic e é convertido
 * nos dois sentidos: tool_use ↔ tool_calls e tool_result ↔ mensagens com role "tool".
 */

interface OaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

const DEFAULT_BASE = "https://api.openai.com/v1";
const isLocal = (url?: string) => Boolean(url && /localhost|127\.0\.0\.1/.test(url));

export function openaiHasCredentials(llm: LlmConfig) {
  return Boolean(llm.apiKey || isLocal(llm.baseUrl));
}

function toOpenAi(system: string, messages: Msg[]): OaMessage[] {
  const out: OaMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const blocks = m.content as {
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: unknown;
    }[];
    if (m.role === "assistant") {
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      const calls = blocks.filter((b) => b.type === "tool_use");
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id!,
                type: "function" as const,
                function: { name: c.name!, arguments: JSON.stringify(c.input ?? {}) },
              })),
            }
          : {}),
      });
    } else {
      for (const b of blocks) {
        if (b.type === "tool_result")
          out.push({
            role: "tool",
            tool_call_id: b.tool_use_id!,
            content: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
          });
        else if (b.type === "text") out.push({ role: "user", content: b.text ?? "" });
      }
    }
  }
  return out;
}

export async function callOpenAi(call: LlmCall): Promise<AssistantTurn> {
  const { llm, emit } = call;
  const key = llm.apiKey;
  const url = `${(llm.baseUrl || DEFAULT_BASE).replace(/\/$/, "")}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: call.signal,
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model: llm.model,
        max_tokens: llm.maxTokens || 4096,
        stream: true,
        stream_options: { include_usage: true },
        messages: toOpenAi(call.system, call.messages),
        ...(call.tools.length
          ? {
              tools: call.tools.map((t) => ({
                type: "function",
                function: { name: t.name, description: t.description ?? "", parameters: t.input_schema },
              })),
            }
          : {}),
      }),
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new Error(
      `Não foi possível conectar a ${url} (${(err as Error).message}). Verifique a URL base da LLM e se o provedor permite chamadas do navegador (CORS).`,
    );
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Erro do provedor (${res.status}): ${detail.slice(0, 400) || res.statusText}`);
  }

  let text = "";
  let finish: string | null = null;
  let usage = { input: 0, output: 0 };
  let model = llm.model;
  const calls: { id: string; name: string; args: string }[] = [];

  // Lê o stream SSE: linhas "data: {...}" terminando em "data: [DONE]".
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, "");
      if (!data || data === "[DONE]" || !line.trim().startsWith("data:")) continue;
      let chunk: {
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices?: {
          delta?: {
            content?: string;
            reasoning?: string;
            reasoning_content?: string;
            tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
          finish_reason?: string | null;
        }[];
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.model) model = chunk.model;
      if (chunk.usage) usage = { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0 };
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const d = choice.delta ?? {};
      const reasoning = d.reasoning ?? d.reasoning_content;
      if (reasoning) emit({ type: "thinking.delta", text: reasoning });
      if (d.content) {
        text += d.content;
        emit({ type: "text.delta", text: d.content });
      }
      for (const tc of d.tool_calls ?? []) {
        const slot = (calls[tc.index] ??= { id: "", name: "", args: "" });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }

  const content: Block[] = [];
  if (text) content.push({ type: "text", text });
  for (const c of calls.filter(Boolean)) {
    let input: Record<string, unknown> = {};
    try {
      input = c.args ? JSON.parse(c.args) : {};
    } catch {
      input = { _erro: "argumentos JSON inválidos gerados pelo modelo", bruto: c.args };
    }
    content.push({ type: "tool_use", id: c.id || `call_${Math.random().toString(36).slice(2, 10)}`, name: c.name, input });
  }
  const stopReason = calls.length ? "tool_use" : finish === "length" ? "max_tokens" : "end_turn";
  return { content, stopReason, usage, model };
}
