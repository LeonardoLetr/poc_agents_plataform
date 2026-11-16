import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPACTED_MARKER, extractSummary, shouldCompact, SUMMARY_REQUEST_MARKER } from "../agent/context.js";
import { contextWindowFor } from "../llm/catalog.js";
import { bootCore, collectRun, type StreamEvent } from "./helpers.js";

const ofType = <T extends StreamEvent["type"]>(events: StreamEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<StreamEvent, { type: T }>[];

afterEach(() => vi.unstubAllGlobals());

describe("regras da janela de contexto", () => {
  it("dispara o resumo só quando habilitado, acima do limite e com histórico suficiente", () => {
    const base = {
      enabled: true,
      thresholdPct: 60,
      tokens: 700,
      window: 1000,
      messageCount: 5,
      historyShare: 0.8,
      lastMessageFromUser: true,
      iterationsSinceCompaction: null,
    };
    expect(shouldCompact(base)).toBe(true);
    expect(shouldCompact({ ...base, enabled: false })).toBe(false);
    expect(shouldCompact({ ...base, tokens: 500 })).toBe(false);
    expect(shouldCompact({ ...base, messageCount: 1 })).toBe(false);
  });

  it("não resume no meio de uma rodada de ferramentas nem logo depois de outro resumo", () => {
    const base = {
      enabled: true,
      thresholdPct: 60,
      tokens: 700,
      window: 1000,
      messageCount: 5,
      historyShare: 0.8,
      lastMessageFromUser: true,
      iterationsSinceCompaction: null,
    };
    expect(shouldCompact({ ...base, lastMessageFromUser: false })).toBe(false);
    expect(shouldCompact({ ...base, iterationsSinceCompaction: 1 })).toBe(false);
    expect(shouldCompact({ ...base, iterationsSinceCompaction: 2 })).toBe(true);
  });

  it("extrai o resumo das tags e resolve a janela pelo catálogo, pela LLM ou pelo padrão do provedor", () => {
    expect(extractSummary("antes <summary>\n conteúdo \n</summary> depois")).toBe("conteúdo");
    expect(extractSummary("sem tags")).toBe("sem tags");
    expect(contextWindowFor({ provider: "anthropic", model: "claude-opus-5-5" })).toBe(1_000_000);
    expect(contextWindowFor({ provider: "openai", model: "x", contextWindow: 32_000 })).toBe(32_000);
    expect(contextWindowFor({ provider: "openai", model: "x" })).toBe(128_000);
  });
});

describe("medição e resumo automático no loop", () => {
  it("mede a janela a cada iteração", async () => {
    const { core, api, db } = await bootCore();
    const demo = db.agents.find((a) => a.name === "Agente Demo (offline)")!;
    expect(demo.context).toEqual({ autoCompact: true, thresholdPct: 50 });
    const run = await api("POST", "/api/runs", { agentId: demo.id, input: "Quanto é (1250 * 1.08) ^ 2 e que horas são agora?" });
    const events = await collectRun(core, run.body.id);

    const measured = ofType(events, "context.measured");
    expect(measured.length).toBeGreaterThanOrEqual(4);
    expect(measured.every((m) => m.window === 4_000 && m.tokens > 0)).toBe(true);
    expect(measured[1]?.tokens ?? 0).toBeGreaterThan(measured[0]?.tokens ?? 0);
    expect(measured[1]?.breakdown.history ?? 0).toBeGreaterThan(measured[0]?.breakdown.history ?? 0);
    expect(db.runs.find((r) => r.id === run.body.id)!.context).toEqual({ tokens: measured.at(-1)!.tokens, window: 4_000 });
  });

  it("resume o histórico ao continuar a conversa e mantém a nova mensagem fora do resumo", async () => {
    const { core, api, db } = await bootCore();
    const demo = db.agents.find((a) => a.name === "Agente Demo (offline)")!;
    const run = await api("POST", "/api/runs", { agentId: demo.id, input: "Quanto é 3 * 3?" });
    await collectRun(core, run.body.id);

    // Cada nova mensagem aumenta o histórico até passar do limite (50% da janela simulada).
    const followUps = [
      "Quanto é 12 * 12?",
      "E quanto é 7 * 8?",
      "Quanto é 99 * 3?",
      "Quanto é 15 * 15?",
      "Quanto é 21 * 4?",
      "Quanto é 30 * 30?",
    ];
    let events: StreamEvent[] = [];
    let last = "";
    for (const text of followUps) {
      const done = collectRun(core, run.body.id, { ignoreSnapshot: true });
      await api("POST", `/api/runs/${run.body.id}/messages`, { text });
      events = await done;
      last = text;
      if (ofType(events, "context.compacted").length) break;
    }

    const [compacted] = ofType(events, "context.compacted");
    if (!compacted) throw new Error("compactação não registrada");
    expect(compacted.tokensAfter).toBeLessThan(compacted.tokensBefore);
    expect(compacted.tokensBefore / 4_000).toBeGreaterThanOrEqual(0.5);
    expect(compacted.summary).toContain("= **9**");
    const nextMeasure = events.slice(events.indexOf(compacted)).find((e) => e.type === "context.measured") as { messageCount: number };
    const record = db.runs.find((r) => r.id === run.body.id)!;
    expect(String((record.messages[0] as { content: unknown }).content).startsWith(COMPACTED_MARKER)).toBe(true);
    if (nextMeasure.messageCount === 2) {
      // Resumo no início da continuação: a nova pergunta segue fora do resumo, logo depois dele.
      expect(compacted.summary).not.toContain(last);
      expect(record.messages[1]).toEqual({ role: "user", content: last });
    } else {
      // Resumo no meio da continuação: a pergunta atual faz parte do resumo.
      expect(nextMeasure.messageCount).toBe(1);
      expect(compacted.summary).toContain(last);
    }
    expect(record.compactions).toHaveLength(1);
    expect(db.audit.some((a) => a.type === "context.compacted" && a.runId === record.id)).toBe(true);
  });

  it("não resume quando o agente não habilitou", async () => {
    const { core, api, db } = await bootCore();
    const demo = db.agents.find((a) => a.name === "Agente Demo (offline)")!;
    await api("PUT", `/api/agents/${demo.id}`, { ...demo, context: { autoCompact: false, thresholdPct: 5 } });
    const run = await api("POST", "/api/runs", { agentId: demo.id, input: "Quanto é 2 + 2 e que horas são?" });
    const events = await collectRun(core, run.body.id);
    expect(ofType(events, "context.compacted")).toHaveLength(0);
    expect(ofType(events, "context.measured").length).toBeGreaterThan(0);
  });

  it("não resume quando o contexto é dominado por prompt e ferramentas", () => {
    const share = {
      enabled: true,
      thresholdPct: 10,
      tokens: 900,
      window: 1000,
      messageCount: 5,
      lastMessageFromUser: true,
      iterationsSinceCompaction: null,
    };
    expect(shouldCompact({ ...share, historyShare: 0.2 })).toBe(false);
    expect(shouldCompact({ ...share, historyShare: 0.6 })).toBe(true);
  });
});

describe("resumo com a API da Anthropic", () => {
  const sse = (events: Record<string, unknown>[]) =>
    new Response(events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join(""), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  const start = (input: number) => ({
    type: "message_start",
    message: {
      id: "m",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: input, output_tokens: 1 },
    },
  });
  const end = (stop: string) => [
    { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: "message_stop" },
  ];
  const thinking = (i: number) => [
    { type: "content_block_start", index: i, content_block: { type: "thinking", thinking: "", signature: "" } },
    { type: "content_block_delta", index: i, delta: { type: "thinking_delta", thinking: "planejando" } },
    { type: "content_block_delta", index: i, delta: { type: "signature_delta", signature: "assinatura" } },
    { type: "content_block_stop", index: i },
  ];
  const text = (i: number, t: string) => [
    { type: "content_block_start", index: i, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: i, delta: { type: "text_delta", text: t } },
    { type: "content_block_stop", index: i },
  ];

  it("pede o resumo com as mesmas ferramentas e recomeça só com ele, sem reenviar raciocínio antigo", async () => {
    const { core, api } = await bootCore();
    const bodies: { messages: { role: string; content: unknown }[]; tools: { name: string }[] }[] = [];
    const responses = [
      // 1: chama a calculadora com o contexto já em 70% da janela de 1M.
      () =>
        sse([
          start(700_000),
          ...thinking(0),
          { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "calculator", input: {} } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"expression":"6*7"}' } },
          { type: "content_block_stop", index: 1 },
          ...end("tool_use"),
        ]),
      // 2: pedido de resumo.
      () => sse([start(700_100), ...text(0, "<summary>Calculado 6*7 = 42. Falta responder.</summary>"), ...end("end_turn")]),
      // 3: continuação a partir do resumo.
      () => sse([start(2_000), ...text(0, "A resposta é 42."), ...end("end_turn")]),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        const respond = responses[bodies.length - 1];
        if (!respond) throw new Error("requisição inesperada");
        return respond();
      }),
    );

    const llm = await api("POST", "/api/llms", {
      name: "Opus contexto",
      provider: "anthropic",
      model: "claude-opus-5-5",
      apiKey: "sk-ant-teste-contexto",
      effort: "medium",
      refusalFallback: false,
    });
    const agent = await api("POST", "/api/agents", {
      name: "Longo",
      llmId: llm.body.id,
      systemPrompt: "Calcule.",
      tools: ["calculator"],
      maxIterations: 5,
      requireApproval: false,
      memory: { autoRecall: false, autoEpisode: false, recallLimit: 3 },
      context: { autoCompact: true, thresholdPct: 60 },
    });
    // Tarefa longa: o histórico precisa ser uma parte relevante do contexto para o resumo compensar.
    const run = await api("POST", "/api/runs", {
      agentId: agent.body.id,
      input: `quanto é 6*7? Contexto: ${"dados do relatório ".repeat(150)}`,
    });
    const events = await collectRun(core, run.body.id);

    expect(events.at(-1)).toMatchObject({ type: "run.completed", output: "A resposta é 42." });
    expect(bodies).toHaveLength(3);
    // Pedido de resumo: histórico completo + instrução, com a mesma lista de ferramentas.
    expect(bodies[1]?.tools.map((t) => t.name)).toEqual(bodies[0]?.tools.map((t) => t.name));
    const summaryRequest = bodies[1]?.messages.at(-1);
    if (!summaryRequest) throw new Error("pedido de resumo não enviado");
    expect(summaryRequest.role).toBe("user");
    expect(String(summaryRequest.content).startsWith(SUMMARY_REQUEST_MARKER)).toBe(true);
    // Depois do resumo, nenhuma mensagem antiga (nem bloco de raciocínio) é reenviada.
    expect(bodies[2]?.messages).toHaveLength(1);
    expect(String(bodies[2]?.messages[0]?.content)).toContain("Calculado 6*7 = 42");
    expect(JSON.stringify(bodies[2]?.messages)).not.toContain("assinatura");
    expect(ofType(events, "context.compacted")[0]).toMatchObject({ tokensBefore: 700_000, thresholdPct: 60 });
  });
});
