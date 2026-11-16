import { afterEach, describe, expect, it, vi } from "vitest";
import { callOpenAi } from "../llm/openai.js";
import type { LlmCall } from "../llm/types.js";
import type { LlmConfig, RunEvent } from "../types.js";

/** Monta uma resposta SSE no formato do Chat Completions. */
function sse(chunks: unknown[]) {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const llm: LlmConfig = {
  id: "llm_t",
  name: "Teste",
  provider: "openai",
  model: "modelo-x",
  apiKey: "sk-teste",
  baseUrl: "https://exemplo.dev/v1",
  effort: "medium",
  refusalFallback: false,
  maxTokens: 1000,
  createdAt: "",
  updatedAt: "",
};

function call(messages: LlmCall["messages"], emit: (e: RunEvent) => void = () => {}): LlmCall {
  return {
    llm,
    emit,
    messages,
    system: "Seja breve.",
    signal: new AbortController().signal,
    tools: [
      { name: "calculator", description: "Calcula", input_schema: { type: "object", properties: { expression: { type: "string" } } } },
    ],
    input: "",
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("provedor compatível com OpenAI", () => {
  it("converte o histórico (tool_use → tool_calls, tool_result → role tool) e envia as ferramentas", async () => {
    const fetchMock = vi.fn(async () => sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]));
    vi.stubGlobal("fetch", fetchMock);

    await callOpenAi(
      call([
        { role: "user", content: "quanto é 6*7?" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Vou calcular." },
            { type: "tool_use", id: "call_1", name: "calculator", input: { expression: "6*7" } },
          ],
        },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "42" }] },
      ]),
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://exemplo.dev/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-teste");
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "Seja breve." },
      { role: "user", content: "quanto é 6*7?" },
      {
        role: "assistant",
        content: "Vou calcular.",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "calculator", arguments: '{"expression":"6*7"}' } }],
      },
      { role: "tool", tool_call_id: "call_1", content: "42" },
    ]);
    expect(body.tools[0]).toMatchObject({ type: "function", function: { name: "calculator" } });
    expect(body.stream).toBe(true);
  });

  it("monta tool_use a partir de argumentos transmitidos em pedaços e repassa o texto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse([
          { model: "modelo-x-2026", choices: [{ delta: { content: "Calculando. " } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_9", function: { name: "calculator", arguments: '{"expre' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ssion":"2+2"}' } }] }, finish_reason: "tool_calls" }] },
          { choices: [], usage: { prompt_tokens: 50, completion_tokens: 9 } },
        ]),
      ),
    );
    const deltas: string[] = [];
    const turn = await callOpenAi(call([{ role: "user", content: "2+2?" }], (e) => e.type === "text.delta" && deltas.push(e.text)));

    expect(deltas.join("")).toBe("Calculando. ");
    expect(turn.stopReason).toBe("tool_use");
    expect(turn.usage).toEqual({ input: 50, output: 9 });
    expect(turn.model).toBe("modelo-x-2026");
    expect(turn.content).toEqual([
      { type: "text", text: "Calculando. " },
      { type: "tool_use", id: "call_9", name: "calculator", input: { expression: "2+2" } },
    ]);
  });

  it("repassa o raciocínio quando o provedor envia reasoning_content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse([
          { choices: [{ delta: { reasoning_content: "pensando…" } }] },
          { choices: [{ delta: { content: "fim" }, finish_reason: "stop" }] },
        ]),
      ),
    );
    const thinking: string[] = [];
    await callOpenAi(call([{ role: "user", content: "oi" }], (e) => e.type === "thinking.delta" && thinking.push(e.text)));
    expect(thinking).toEqual(["pensando…"]);
  });

  it("não quebra com argumentos JSON inválidos gerados pelo modelo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse([
          {
            choices: [
              {
                delta: { tool_calls: [{ index: 0, id: "c", function: { name: "calculator", arguments: "{quebrado" } }] },
                finish_reason: "tool_calls",
              },
            ],
          },
        ]),
      ),
    );
    const turn = await callOpenAi(call([{ role: "user", content: "x" }]));
    expect(turn.content[0]).toMatchObject({ type: "tool_use", input: { _erro: expect.any(String), bruto: "{quebrado" } });
  });

  it("traduz erros HTTP e de conexão em mensagens claras", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("chave inválida", { status: 401 })),
    );
    await expect(callOpenAi(call([{ role: "user", content: "x" }]))).rejects.toThrow(/Erro do provedor \(401\): chave inválida/);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(callOpenAi(call([{ role: "user", content: "x" }]))).rejects.toThrow(
      /Não foi possível conectar a https:\/\/exemplo\.dev\/v1\/chat\/completions/,
    );
  });

  it("marca max_tokens quando a resposta é cortada", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sse([{ choices: [{ delta: { content: "texto cort" }, finish_reason: "length" }] }])),
    );
    expect((await callOpenAi(call([{ role: "user", content: "x" }]))).stopReason).toBe("max_tokens");
  });
});
