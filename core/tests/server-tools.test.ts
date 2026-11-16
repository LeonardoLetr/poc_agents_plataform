import { afterEach, describe, expect, it, vi } from "vitest";
import { callAnthropic } from "../llm/anthropic.js";
import type { LlmCall } from "../llm/types.js";
import { answerText, turnText } from "../agent/runner.js";
import { collectCitations, describeServerResult, serverToolDefinitions } from "../tools/server.js";
import type { LlmConfig, RunEvent } from "../types.js";
import { bootCore, collectRun } from "./helpers.js";

/** Resposta SSE no formato da API de Mensagens da Anthropic. */
function anthropicSse(events: Record<string, unknown>[]) {
  const body = events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const start = (id = "msg_1") => ({
  type: "message_start",
  message: { id, type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 50, output_tokens: 1 } },
});
const end = (stop_reason: string) => [
  { type: "message_delta", delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 30 } },
  { type: "message_stop" },
];

/** Turno com busca na web: server_tool_use → web_search_tool_result → texto com citação. */
function searchTurn(stop = "end_turn") {
  return anthropicSse([
    start(),
    { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"agentes autônomos"}' } },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_1",
        content: [{ type: "web_search_result", title: "Guia de agentes", url: "https://exemplo.dev/agentes", encrypted_content: "x", page_age: null }],
      },
    },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "text", text: "", citations: [] } },
    { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Agentes usam ferramentas em loop." } },
    {
      type: "content_block_delta",
      index: 2,
      delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://exemplo.dev/agentes", title: "Guia de agentes", cited_text: "agentes chamam ferramentas", encrypted_index: "i" } },
    },
    { type: "content_block_stop", index: 2 },
    ...end(stop),
  ]);
}

const llm = (apiKey: string): LlmConfig => ({
  id: "llm_t", name: "Opus teste", provider: "anthropic", model: "claude-opus-5-5", apiKey,
  effort: "medium", refusalFallback: false, maxTokens: 1000, createdAt: "", updatedAt: "",
});

afterEach(() => vi.unstubAllGlobals());

describe("definição das ferramentas de servidor", () => {
  it("usa as versões com filtragem dinâmica nos modelos compatíveis e as básicas nos demais", () => {
    expect(serverToolDefinitions(["web_search", "web_fetch"], "claude-opus-5-5").map((t) => t.type)).toEqual(["web_search_20260209", "web_fetch_20260209"]);
    expect(serverToolDefinitions(["web_search", "web_fetch"], "claude-sonnet-5-5").map((t) => t.type)).toEqual(["web_search_20260209", "web_fetch_20260209"]);
    expect(serverToolDefinitions(["web_search", "web_fetch"], "claude-haiku-5-5").map((t) => t.type)).toEqual(["web_search_20250305", "web_fetch_20250910"]);
    expect(serverToolDefinitions(["calculator"], "claude-opus-5-5")).toEqual([]);
  });

  it("limita usos e ativa citações na leitura de páginas", () => {
    const [fetchDef] = serverToolDefinitions(["web_fetch"], "claude-opus-5-5") as { max_uses?: number; citations?: { enabled: boolean } }[];
    expect(fetchDef?.max_uses).toBe(5);
    expect(fetchDef?.citations).toEqual({ enabled: true });
  });
});

describe("leitura dos resultados", () => {
  it("formata resultados de busca, documentos e erros (que chegam como objeto, não exceção)", () => {
    const search = describeServerResult({ type: "web_search_tool_result", content: [{ type: "web_search_result", title: "A", url: "https://a.dev" }] });
    expect(search).toEqual({ output: "1. A — https://a.dev", isError: false });

    const error = describeServerResult({ type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } });
    expect(error.isError).toBe(true);
    expect(error.output).toContain("max_uses_exceeded");

    const doc = describeServerResult({
      type: "web_fetch_tool_result",
      content: { type: "web_fetch_result", url: "https://b.dev", content: { type: "document", title: "Página B", source: { type: "text", media_type: "text/plain", data: "conteúdo da página" } } },
    });
    expect(doc.isError).toBe(false);
    expect(doc.output).toContain("https://b.dev");
    expect(doc.output).toContain("conteúdo da página");
  });

  it("coleta citações sem duplicar", () => {
    const cite = { type: "web_search_result_location", url: "https://a.dev", title: "A", cited_text: "trecho" };
    const items = collectCitations([
      { type: "text", text: "x", citations: [cite, cite] },
      { type: "text", text: "y" },
    ]);
    expect(items).toEqual([{ url: "https://a.dev", title: "A", citedText: "trecho" }]);
  });
});

describe("texto da resposta", () => {
  const content = [
    { type: "thinking", thinking: "..." },
    { type: "text", text: "Vou buscar." },
    { type: "server_tool_use" },
    { type: "web_search_tool_result" },
    { type: "text", text: "O MCP padroniza ferramentas" },
    { type: "text", text: " e recursos." },
  ];
  it("separa em parágrafos os textos divididos por ferramentas e une os divididos por citações", () => {
    expect(turnText(content)).toBe("Vou buscar.\n\nO MCP padroniza ferramentas e recursos.");
  });
  it("usa como resposta final apenas o texto após o último resultado", () => {
    expect(answerText(content, "fallback")).toBe("O MCP padroniza ferramentas e recursos.");
    expect(answerText([{ type: "text", text: "só texto" }], "só texto")).toBe("só texto");
  });
});

describe("provedor Anthropic com ferramentas de servidor", () => {
  it("envia as definições na requisição e emite chamada e resultado ao vivo", async () => {
    const fetchMock = vi.fn(async () => searchTurn());
    vi.stubGlobal("fetch", fetchMock);
    const events: RunEvent[] = [];
    const call: LlmCall = {
      llm: llm("sk-ant-teste-provedor"),
      agent: {} as LlmCall["agent"],
      run: {} as LlmCall["run"],
      system: "Pesquise.",
      messages: [{ role: "user", content: "o que são agentes?" }],
      tools: [],
      serverTools: serverToolDefinitions(["web_search"], "claude-opus-5-5"),
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    };

    const turn = await callAnthropic(call);

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 5 }]);
    expect(turn.stopReason).toBe("end_turn");
    const callEv = events.find((e) => e.type === "tool.call");
    expect(callEv).toMatchObject({ id: "srvtoolu_1", name: "web_search", source: "server", input: { query: "agentes autônomos" } });
    const resultEv = events.find((e) => e.type === "tool.result");
    expect(resultEv).toMatchObject({ id: "srvtoolu_1", name: "web_search", isError: false });
    expect((resultEv as { output: string }).output).toContain("https://exemplo.dev/agentes");
  });
});

describe("loop agêntico com ferramentas de servidor", () => {
  it("retoma após pause_turn, registra auditoria e emite as citações", async () => {
    const { core, api, db } = await bootCore();
    const requests: { messages: { role: string }[]; tools?: { name: string }[] }[] = [];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(init.body as string));
      return searchTurn(n++ === 0 ? "pause_turn" : "end_turn");
    }));

    const created = await api("POST", "/api/llms", { name: "Opus web", provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-ant-teste-loop", effort: "medium", refusalFallback: false });
    const agent = await api("POST", "/api/agents", {
      name: "Pesquisador web", llmId: created.body.id, systemPrompt: "Pesquise.", tools: ["web_search", "calculator"], maxIterations: 4, requireApproval: false,
      memory: { autoRecall: false, autoEpisode: false, recallLimit: 3 },
    });
    const run = await api("POST", "/api/runs", { agentId: agent.body.id, input: "o que são agentes?" });
    const events = await collectRun(core, run.body.id);

    expect(events.at(-1)?.type).toBe("run.completed");
    expect(requests).toHaveLength(2);
    // A retomada reenvia o turno pausado do assistente como última mensagem, sem "continue" extra.
    expect(requests[1]?.messages.at(-1)?.role).toBe("assistant");
    expect(requests[0]?.tools?.map((t) => t.name)).toEqual(["calculator", "web_search"]);
    expect(events.filter((e) => e.type === "tool.call" && e.source === "server")).toHaveLength(2);
    expect(events.some((e) => e.type === "citations")).toBe(true);
    const completed = events.at(-1) as { output: string };
    // A resposta final é o texto depois do último resultado de ferramenta de servidor.
    expect(completed.output).toBe("Agentes usam ferramentas em loop.");
    const auditTypes = db.audit.filter((a) => a.runId === run.body.id).map((a) => a.type);
    expect(auditTypes.filter((t) => t === "tool.call")).toHaveLength(2);
    expect(auditTypes.filter((t) => t === "tool.result")).toHaveLength(2);
  });

  it("não envia ferramentas de servidor a LLMs de outros provedores", async () => {
    const { core, api, db } = await bootCore();
    const bodies: { tools?: { function: { name: string } }[] }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      const chunk = { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
    }));
    const created = await api("POST", "/api/llms", { name: "Compatível", provider: "openai", model: "x", apiKey: "sk-x", baseUrl: "https://exemplo.dev/v1", effort: "medium", refusalFallback: false });
    const agent = await api("POST", "/api/agents", {
      name: "Sem servidor", llmId: created.body.id, systemPrompt: "Oi.", tools: ["web_search", "calculator"], maxIterations: 2, requireApproval: false,
      memory: { autoRecall: false, autoEpisode: false, recallLimit: 3 },
    });
    const run = await api("POST", "/api/runs", { agentId: agent.body.id, input: "olá" });
    await collectRun(core, run.body.id);

    expect(bodies[0]?.tools?.map((t) => t.function.name)).toEqual(["calculator"]);
    const request = db.audit.find((a) => a.runId === run.body.id && a.type === "llm.request");
    expect(request?.data).toMatchObject({ serverToolsIgnored: ["web_search"] });
  });
});
