import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { parseJson } from "../util.js";
import type { LlmConfig } from "../types.js";
import type { AssistantTurn, Block, LlmCall, Msg } from "./types.js";

/**
 * Provedores compatíveis com a API de Chat Completions (OpenAI, OpenRouter,
 * Groq, Ollama). O histórico interno usa o formato da Anthropic e é convertido
 * nos dois sentidos: tool_use ↔ tool_calls e tool_result ↔ mensagens com role "tool".
 */

type OaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

const DEFAULT_BASE = "https://api.openai.com/v1";
const isLocal = (url?: string) => Boolean(url && /localhost|127\.0\.0\.1/.test(url));

export function openaiHasCredentials(llm: LlmConfig) {
  return Boolean(llm.apiKey || isLocal(llm.baseUrl));
}

function toOpenAi(system: string, messages: Msg[]): OaMessage[] {
  const out: OaMessage[] = [{ role: "system", content: system }];
  for (const { role, content } of messages) {
    // Mensagens de sistema do SDK podem vir sem conteúdo (só configuração); não há o que converter.
    if (content === undefined) continue;
    if (typeof content === "string") {
      out.push({ role, content });
      continue;
    }
    if (role === "assistant") {
      const text = content
        .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === "text")
        .map((b) => b.text)
        .join("");
      const calls = content.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use");
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
              })),
            }
          : {}),
      });
    } else {
      for (const b of content) {
        if (b.type === "tool_result")
          out.push({
            role: "tool",
            tool_call_id: b.tool_use_id,
            content: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
          });
        else if (b.type === "text") out.push({ role: "user", content: b.text });
      }
    }
  }
  return out;
}

/** Pedaço do stream de Chat Completions: só os campos usados; o resto é ignorado. */
const Chunk = z.object({
  model: z.string().optional(),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).nullish(),
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullish(),
            reasoning: z.string().nullish(),
            reasoning_content: z.string().nullish(),
            tool_calls: z
              .array(
                z.object({
                  index: z.number(),
                  id: z.string().optional(),
                  function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional(),
                }),
              )
              .optional(),
          })
          .optional(),
        finish_reason: z.string().nullish(),
      }),
    )
    .optional(),
});

/** Lê uma linha "data:" do stream; JSON inválido ou fora do formato é descartado. */
function parseChunk(data: string): z.infer<typeof Chunk> | null {
  const parsed = Chunk.safeParse(parseJson(data));
  return parsed.success ? parsed.data : null;
}

/** Argumentos de ferramenta gerados pelo modelo: precisam ser um objeto JSON. */
function parseToolArgs(args: string): Record<string, unknown> {
  if (!args) return {};
  const parsed = z.record(z.string(), z.unknown()).safeParse(parseJson(args));
  // O erro volta ao modelo como entrada da ferramenta, para ele corrigir os argumentos na próxima iteração.
  return parsed.success ? parsed.data : { _erro: "argumentos JSON inválidos gerados pelo modelo", bruto: args };
}

async function postChatCompletion(call: LlmCall, url: string): Promise<ReadableStream<Uint8Array>> {
  const { llm } = call;
  const key = llm.apiKey;
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
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new Error(
      `Não foi possível conectar a ${url} (${err instanceof Error ? err.message : String(err)}). Verifique a URL base da LLM e se o provedor permite chamadas do navegador (CORS).`,
      { cause: err },
    );
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Erro do provedor (${res.status}): ${detail.slice(0, 400) || res.statusText}`);
  }
  return res.body;
}

type StreamedTurn = {
  text: string;
  finish: string | null;
  usage: { input: number; output: number };
  model: string;
  calls: { id: string; name: string; args: string }[];
};

/** Lê o stream SSE (linhas "data: {...}" terminando em "data: [DONE]"), repassando texto e raciocínio ao vivo. */
async function readChatStream(body: ReadableStream<Uint8Array>, emit: LlmCall["emit"], model: string): Promise<StreamedTurn> {
  const turn: StreamedTurn = { text: "", finish: null, usage: { input: 0, output: 0 }, model, calls: [] };
  const reader = body.getReader();
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
      const chunk = parseChunk(data);
      if (!chunk) continue;
      if (chunk.model) turn.model = chunk.model;
      if (chunk.usage) turn.usage = { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0 };
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const d = choice.delta ?? {};
      const reasoning = d.reasoning ?? d.reasoning_content;
      if (reasoning) emit({ type: "thinking.delta", text: reasoning });
      if (d.content) {
        turn.text += d.content;
        emit({ type: "text.delta", text: d.content });
      }
      // As chamadas de ferramenta chegam em pedaços, indexadas pela posição no turno.
      for (const tc of d.tool_calls ?? []) {
        const slot = (turn.calls[tc.index] ??= { id: "", name: "", args: "" });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
      }
      if (choice.finish_reason) turn.finish = choice.finish_reason;
    }
  }
  return turn;
}

export async function callOpenAi(call: LlmCall): Promise<AssistantTurn> {
  const url = `${(call.llm.baseUrl || DEFAULT_BASE).replace(/\/$/, "")}/chat/completions`;
  const { text, finish, usage, model, calls } = await readChatStream(await postChatCompletion(call, url), call.emit, call.llm.model);
  const content: Block[] = [];
  if (text) content.push({ type: "text", text });
  for (const c of calls.filter(Boolean)) {
    const input = parseToolArgs(c.args);
    content.push({ type: "tool_use", id: c.id || `call_${Math.random().toString(36).slice(2, 10)}`, name: c.name, input });
  }
  const stopReason = calls.length ? "tool_use" : finish === "length" ? "max_tokens" : "end_turn";
  return { content, stopReason, usage, model };
}
